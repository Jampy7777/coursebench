import { buildBody } from "../providers/anthropic.js";

// Coursebench proxy (Cloudflare Worker) — the SRM-key path.
//
// Security invariants (enforced + tested):
//   - SRM's key lives ONLY in env.ANTHROPIC_API_KEY (a Worker secret); it never
//     appears in a response or a log.
//   - The client cannot supply a system prompt. The Worker reads only
//     { jigId, text, model }, loads the jig server-side, and builds the
//     editorial prompt itself — so the endpoint can't be used as a free Claude.
//   - Tokens are looked up by SHA-256 hash; plaintext is never stored or logged.
//   - Origin is gated per client. jigId is format-checked and allow-listed.
//   - Telemetry is content-free: no request or response text is ever stored.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const JIG_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

export function validateJigId(id) {
  return typeof id === "string" && JIG_ID_RE.test(id);
}

export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

async function lookupToken(env, deps, tokenHash) {
  const url =
    `${env.SUPABASE_URL}/rest/v1/client_tokens` +
    `?token_hash=eq.${tokenHash}&active=is.true` +
    `&select=client_id,allowed_jigs,allowed_origins`;
  const r = await deps.fetch(url, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY },
  });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return rows && rows[0] ? rows[0] : null;
}

async function logUsage(env, deps, row) {
  try {
    await deps.fetch(`${env.SUPABASE_URL}/rest/v1/usage_log`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
  } catch {
    /* telemetry must never block or fail the request */
  }
}

async function fetchJig(env, deps, jigId) {
  const r = await deps.fetch(`${env.JIG_BASE_URL}/${jigId}.json`);
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

export async function handleRequest(request, env, deps = { fetch }) {
  const origin = request.headers.get("Origin") || "";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405, origin);

  // 1. Authenticate (hashed token lookup)
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ error: "missing token" }, 401, origin);
  const rec = await lookupToken(env, deps, await sha256Hex(token));
  if (!rec) return json({ error: "invalid token" }, 401, origin);

  // 2. Origin gating
  const origins = rec.allowed_origins || [];
  if (origins.length && origin && !origins.includes(origin)) {
    return json({ error: "origin not allowed" }, 403, origin);
  }

  // 3. Rate limit (production: Cloudflare Rate Limiting binding or a Durable Object)
  const okRate = deps.checkRateLimit ? await deps.checkRateLimit(env, rec.client_id) : true;
  if (!okRate) return json({ error: "rate limit exceeded" }, 429, origin);

  // 4. Validate input
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400, origin);
  }
  const { jigId, text, model } = body || {};
  if (!validateJigId(jigId)) return json({ error: "bad jigId" }, 400, origin);
  if ((rec.allowed_jigs || []).length && !rec.allowed_jigs.includes(jigId)) {
    return json({ error: "jig not permitted" }, 403, origin);
  }
  if (typeof text !== "string" || !text.trim()) return json({ error: "missing text" }, 400, origin);

  // 5. Load the jig and build the prompt SERVER-SIDE (client cannot supply one)
  const jig = await fetchJig(env, deps, jigId);
  if (!jig) return json({ error: "jig not found" }, 404, origin);
  const reqBody = buildBody(text, jig, model, 4096);

  // 6. Call Anthropic with SRM's key (server-side only)
  const aiResp = await deps.fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(reqBody),
  });
  const status = aiResp.status;
  const data = await aiResp.json().catch(() => ({}));

  // 7. Content-free telemetry
  await logUsage(env, deps, {
    client_id: rec.client_id,
    jig_id: jigId,
    status,
    input_tokens: data?.usage?.input_tokens ?? null,
    output_tokens: data?.usage?.output_tokens ?? null,
    at: new Date().toISOString(),
  });

  // 8. Relay Anthropic's response shape; the client's parseResponse handles it
  return json(data, status, origin);
}

export default { fetch: (request, env) => handleRequest(request, env) };
