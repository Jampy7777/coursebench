import assert from "node:assert";
import { loadConfig, resolveProvider, DEFAULT_CONFIG } from "../src/ui/deployment.js";

function resp(obj, ok = true, status = 200) {
  return { ok, status, async json() { return obj; } };
}

// loadConfig: merges fetched config over defaults
{
  const cfg = await loadConfig(async () => resp({ mode: "srm", proxyEndpoint: "https://p", token: "t" }));
  assert.equal(cfg.mode, "srm");
  assert.equal(cfg.jigId, "srm-house-style", "defaults fill missing fields");
}
// loadConfig: 404 -> defaults
{
  const cfg = await loadConfig(async () => resp(null, false, 404));
  assert.equal(cfg.mode, DEFAULT_CONFIG.mode);
}
// loadConfig: network throw -> defaults
{
  const cfg = await loadConfig(async () => { throw new Error("offline"); });
  assert.equal(cfg.mode, "client");
}

// resolveProvider: AI off -> null regardless of mode
assert.equal(resolveProvider({ mode: "srm", proxyEndpoint: "x", token: "y" }, { useAI: false }), null);

// srm mode, fully configured -> srm-key provider
{
  const p = resolveProvider({ mode: "srm", proxyEndpoint: "https://p", token: "t", jigId: "srm-house-style" }, { useAI: true });
  assert.equal(p.mode, "srm-key");
}
// srm mode, missing token -> null (deterministic only)
assert.equal(resolveProvider({ mode: "srm", proxyEndpoint: "https://p", token: "" }, { useAI: true }), null);

// client mode with key -> client-key provider
{
  const p = resolveProvider({ mode: "client" }, { useAI: true, clientApiKey: "sk-x" });
  assert.equal(p.mode, "client-key");
}
// client mode without key -> null
assert.equal(resolveProvider({ mode: "client" }, { useAI: true, clientApiKey: "" }), null);

// off mode -> null
assert.equal(resolveProvider({ mode: "off" }, { useAI: true, clientApiKey: "sk-x" }), null);

console.log("All deployment tests passed \u2713");
