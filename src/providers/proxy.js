import { parseResponse } from "./anthropic.js";

// SRM-KEY PATH.
// The browser calls the Cloudflare Worker proxy. SRM's key lives ONLY as a
// Worker secret, server-side — never in the browser. The browser sends just a
// per-client bearer token, a jigId, and the text.
//
// The Worker (Phase 3) is responsible for:
//   - validating the bearer token (Supabase-issued, per client) and Origin
//   - resolving jigId to a KNOWN jig and building the editorial prompt
//     server-side (the client cannot supply an arbitrary system prompt — this
//     stops the authenticated endpoint being used as a free general-purpose
//     Claude)
//   - injecting SRM's key, calling Anthropic under a ZDR agreement
//   - logging NO request/response bodies (in-memory only)
//   - rate-limiting per token
//
// That is why this provider deliberately sends `jigId` rather than the jig
// object, and never sends a system prompt: the server owns both.
export function createProxyProvider({ endpoint, clientToken, jigId, model } = {}) {
  if (!endpoint) throw new Error("ProxyProvider requires the proxy endpoint");
  if (!clientToken) throw new Error("ProxyProvider requires a per-client token");
  if (!jigId) throw new Error("ProxyProvider requires a jigId");
  return {
    mode: "srm-key",
    async callEditor(text, _jig /* server owns the jig */, { fetchImpl = fetch, signal } = {}) {
      const resp = await fetchImpl(endpoint, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + clientToken,
        },
        body: JSON.stringify({ jigId, text, model }),
      });
      return parseResponse(resp);
    },
  };
}
