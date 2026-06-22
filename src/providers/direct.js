import { buildBody, parseResponse, DEFAULT_MODEL } from "./anthropic.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// CLIENT-KEY PATH.
// The client's own Anthropic key, used direct from the browser. The key lives
// only in the client's browser session; it is NEVER sent to SRM or the proxy.
// Requires the dangerous-direct-browser-access header (Anthropic's explicit
// opt-in for browser calls), which is acceptable here because it's the client's
// own key on their own machine.
export function createDirectProvider({ apiKey, model } = {}) {
  if (!apiKey) throw new Error("DirectProvider requires the client's apiKey");
  return {
    mode: "client-key",
    async callEditor(text, jig, { fetchImpl = fetch, signal } = {}) {
      const resp = await fetchImpl(ANTHROPIC_URL, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(buildBody(text, jig, model || DEFAULT_MODEL, 4096)),
      });
      return parseResponse(resp);
    },
  };
}
