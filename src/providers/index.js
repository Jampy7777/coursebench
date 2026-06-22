import { createDirectProvider } from "./direct.js";
import { createProxyProvider } from "./proxy.js";

// ── AIProvider interface ───────────────────────────────────────────────
// Every provider exposes:
//   mode: "client-key" | "srm-key"
//   callEditor(text, jig, opts) -> Promise<Issue[]>
//
// The engine depends ONLY on this interface. It never references Anthropic,
// the proxy, or a key directly. Adding a transport later (e.g. AWS Bedrock for
// an institution that prefers it) means writing a new provider, not touching
// the engine.
//
// THE RULE that keeps "either key" safe:
//   • client keys go DIRECT  — key stays in the client's browser, never to SRM
//   • SRM's key goes via PROXY — key stays a server secret, never in a browser
// A client key is never sent to the proxy; SRM's key is never sent to a browser.
// ───────────────────────────────────────────────────────────────────────

export function selectProvider(cfg = {}) {
  switch (cfg.keyMode) {
    case "client":
      return createDirectProvider({ apiKey: cfg.clientApiKey, model: cfg.model });
    case "srm":
      return createProxyProvider({
        endpoint: cfg.proxyEndpoint,
        clientToken: cfg.clientToken,
        jigId: cfg.jigId,
        model: cfg.model,
      });
    default:
      throw new Error('selectProvider: cfg.keyMode must be "client" or "srm"');
  }
}

export { createDirectProvider, createProxyProvider };
