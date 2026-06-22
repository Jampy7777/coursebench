import { selectProvider } from "../providers/index.js";

// Per-deployment configuration. A client deployment drops a config.json at the
// site root; if absent, the app defaults to bring-your-own-key (client mode).
//
// On the SRM proxy path the token is shipped to the browser. It is NOT a secret
// in the way SRM's Anthropic key is — it's an origin-scoped, rate-limited,
// publishable identifier (think Stripe publishable / Supabase anon key). The
// real protection is server-side: the Worker gates by Origin, checks the jig
// allowlist, and rate-limits. Treat it accordingly.
export const DEFAULT_CONFIG = {
  mode: "client", // "srm" | "client" | "off"
  proxyEndpoint: "",
  jigId: "srm-house-style",
  token: "",
};

export async function loadConfig(fetchImpl = fetch) {
  try {
    const r = await fetchImpl("/config.json", { cache: "no-store" });
    if (!r.ok) return { ...DEFAULT_CONFIG };
    const c = await r.json();
    return { ...DEFAULT_CONFIG, ...c };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// Decide the AI provider for a run. Returns an AIProvider, or null for
// deterministic-only (AI off, or the chosen mode isn't fully configured).
export function resolveProvider(config, { useAI, clientApiKey } = {}) {
  if (!useAI) return null;
  if (config.mode === "srm") {
    if (!config.proxyEndpoint || !config.token) return null;
    return selectProvider({
      keyMode: "srm",
      proxyEndpoint: config.proxyEndpoint,
      clientToken: config.token,
      jigId: config.jigId,
    });
  }
  if (config.mode === "client") {
    if (!clientApiKey) return null;
    return selectProvider({ keyMode: "client", clientApiKey });
  }
  return null; // "off"
}
