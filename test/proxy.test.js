import assert from "node:assert";
import { handleRequest, sha256Hex, validateJigId } from "../src/proxy/worker.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const env = {
  ANTHROPIC_API_KEY: "sk-srm-secret",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_KEY: "svc-key",
  JIG_BASE_URL: "https://coursebench.sixredmarbles.com/jigs",
};

const TOKEN = "tok_test_123";
const KNOWN_HASH = await sha256Hex(TOKEN);
const tokenRecord = { client_id: "c1", allowed_jigs: ["srm-house-style"], allowed_origins: ["https://canvas.odu.edu"] };
const jig = { protect: { selectors: ["code"] }, issues: [{ engine: "ai", instruction: "Edit conservatively." }] };

function resp(obj, status = 200) {
  return { ok: status < 400, status, async json() { return obj; }, async text() { return JSON.stringify(obj); } };
}

function makeDeps(over = {}) {
  const cap = { anthropic: null, log: null };
  const fetchImpl = async (url, opts = {}) => {
    if (url.includes("/rest/v1/client_tokens")) return resp(url.includes(KNOWN_HASH) ? [tokenRecord] : []);
    if (url.includes("/rest/v1/usage_log")) { cap.log = JSON.parse(opts.body); return resp(null, 201); }
    if (url === ANTHROPIC_URL) {
      cap.anthropic = { headers: opts.headers, body: JSON.parse(opts.body) };
      return resp({ content: [{ type: "text", text: "[]" }], usage: { input_tokens: 10, output_tokens: 2 } }, 200);
    }
    if (url.endsWith(".json")) return resp(jig);
    return resp(null, 404);
  };
  return { deps: { fetch: fetchImpl, ...over }, cap };
}

function req({ token, origin, body, method = "POST" }) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  if (origin) headers.Origin = origin;
  return new Request("https://proxy.example/", { method, headers, body: body ? JSON.stringify(body) : undefined });
}

const GOOD = { token: TOKEN, origin: "https://canvas.odu.edu", body: { jigId: "srm-house-style", text: "He affect it." } };

// jigId format guard
assert.ok(validateJigId("srm-house-style"));
assert.ok(!validateJigId("../secrets"));
assert.ok(!validateJigId("a/b"));

// 1. missing token -> 401
{ const { deps } = makeDeps(); const r = await handleRequest(req({ ...GOOD, token: null }), env, deps); assert.equal(r.status, 401); }

// 2. invalid token -> 401
{ const { deps } = makeDeps(); const r = await handleRequest(req({ ...GOOD, token: "tok_bad" }), env, deps); assert.equal(r.status, 401); }

// 3. disallowed origin -> 403
{ const { deps } = makeDeps(); const r = await handleRequest(req({ ...GOOD, origin: "https://evil.example" }), env, deps); assert.equal(r.status, 403); }

// 4. bad jigId -> 400
{ const { deps } = makeDeps(); const r = await handleRequest(req({ ...GOOD, body: { jigId: "../x", text: "hi" } }), env, deps); assert.equal(r.status, 400); }

// 5. jig not permitted -> 403
{ const { deps } = makeDeps(); const r = await handleRequest(req({ ...GOOD, body: { jigId: "other-jig", text: "hi" } }), env, deps); assert.equal(r.status, 403); }

// 6. rate limited -> 429
{ const { deps } = makeDeps({ checkRateLimit: async () => false }); const r = await handleRequest(req(GOOD), env, deps); assert.equal(r.status, 429); }

// 7. success path + security invariants
{
  const { deps, cap } = makeDeps();
  const r = await handleRequest(req(GOOD), env, deps);
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.ok(Array.isArray(data.content), "relays Anthropic response shape");

  // SRM key used server-side, never exposed
  assert.equal(cap.anthropic.headers["x-api-key"], "sk-srm-secret");
  // prompt built server-side from the jig — client never supplied it
  assert.ok(cap.anthropic.body.system.includes("Edit conservatively."));
  // telemetry is content-free
  assert.equal(cap.log.client_id, "c1");
  assert.equal(cap.log.jig_id, "srm-house-style");
  assert.equal(cap.log.status, 200);
  assert.ok(!("text" in cap.log) && !("content" in cap.log), "telemetry must contain no text");
}

// 8. CORS preflight
{ const { deps } = makeDeps(); const r = await handleRequest(req({ origin: "https://canvas.odu.edu", method: "OPTIONS" }), env, deps); assert.equal(r.status, 204); }

console.log("All proxy tests passed \u2713");
