import { getProseText } from "./protect.js";
import { defaultParseHTML } from "./dom.js";

// Run the jig's deterministic rules (regex / term / freq) over the editable
// prose. AI-engine rules are skipped here — they belong to the editorial pass.
// Issues are shaped exactly like AI issues so applyFixToHtml serves both.
export function runDeterministic(html, jig, parseHTML = defaultParseHTML) {
  const prose = getProseText(html, jig.protect || {}, parseHTML);
  const words = (prose.match(/\S+/g) || []).length;
  const issues = [];
  let i = 0;

  for (const rule of jig.issues || []) {
    if (rule.engine === "ai") continue;
    const matches = [...prose.matchAll(new RegExp(rule.find, "gi"))];
    if (!matches.length) continue;

    if (rule.engine === "freq") {
      const allowed = Math.max(
        rule.threshold.max,
        Math.floor(words / rule.threshold.perWords) * rule.threshold.max
      );
      if (matches.length <= allowed) continue; // within tolerance
    }

    for (const m of matches) {
      const flagged = m[0];
      const before = prose.slice(0, m.index).match(/(\S+\s+){0,4}$/);
      const after = prose.slice(m.index + flagged.length).match(/^(\s+\S+){0,4}/);
      let suggestion = null;
      if (rule.replace !== undefined) {
        suggestion = flagged.replace(new RegExp(rule.find, "i"), rule.replace);
      }
      issues.push({
        id: "det-" + rule.id + "-" + i++,
        source: "deterministic",
        ruleId: rule.id,
        type: rule.category,
        category: rule.category,
        tier: rule.tier,
        flagged,
        context_before: (before ? before[0] : "").trim(),
        context_after: (after ? after[0] : "").trim(),
        explanation: rule.message,
        suggestion,
        fixed: false,
        fixFailed: null,
      });
    }
  }
  return { issues, words };
}
