import assert from "node:assert";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { analyzeItem } from "../src/engine/index.js";

const parse = (html) => new JSDOM("<!DOCTYPE html>" + html).window.document;
const jig = JSON.parse(fs.readFileSync(new URL("../jigs/srm-house-style.json", import.meta.url)));

const SAMPLE = `
<p>Please  send it by e-mail. It will affect the outcome.</p>
<pre><code>secret —— do not flag this</code></pre>
`;

// Mock provider captures what it receives and returns one editorial issue.
let sentToAI = null;
const mockProvider = {
  mode: "client-key",
  async callEditor(text /*, jig */) {
    sentToAI = text;
    return [{ type: "usage", flagged: "affect", explanation: "wrong word", suggestion: "effect", context_before: "will", context_after: "the outcome" }];
  },
};

// 1) With a provider: deterministic + AI merge
const r = await analyzeItem(SAMPLE, jig, mockProvider, { parseHTML: parse });
const det = r.issues.filter((i) => i.source === "deterministic");
const ai = r.issues.filter((i) => i.source === "ai");
assert.ok(det.length >= 1, "should have deterministic issues");
assert.equal(ai.length, 1, "should have one AI issue");
assert.equal(ai[0].flagged, "affect");
assert.equal(ai[0].tier, "suggest", "AI issues are suggest-tier");

// 2) The provider saw PROSE ONLY — never the protected code block
assert.ok(sentToAI.includes("send it by e-mail"), "AI should receive prose");
assert.ok(!sentToAI.includes("do not flag"), "WALL: AI must never see protected code");

// 3) Auto-tier was applied to fixedHtml (double space collapsed)
const dbl = det.find((i) => i.ruleId === "double-space");
assert.ok(dbl && dbl.fixed, "double-space should be auto-applied");
assert.ok(r.fixedHtml.includes("Please send it"), "auto fix should collapse the double space");
assert.ok(r.fixedHtml.includes('—— do not flag'), "WALL: code block untouched by auto-fix");

// 4) Issues sorted with auto first
const tiers = r.issues.map((i) => i.tier);
assert.ok(tiers.indexOf("auto") <= tiers.lastIndexOf("suggest"), "auto tier sorts before suggest");

// 5) Deterministic-only when no provider
const r2 = await analyzeItem(SAMPLE, jig, null, { parseHTML: parse });
assert.equal(r2.issues.filter((i) => i.source === "ai").length, 0, "no AI issues without a provider");
assert.ok(r2.issues.length >= 1, "still runs deterministic");

console.log("All orchestrator tests passed \u2713");
