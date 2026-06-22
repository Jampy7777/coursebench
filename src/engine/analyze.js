import { runDeterministic } from "./detect.js";
import { getProseText } from "./protect.js";
import { applyFixToHtml } from "./applyFix.js";
import { defaultParseHTML } from "./dom.js";

const TIER_ORDER = { auto: 0, suggest: 1, flag: 2 };

// Analyze one item end to end:
//   1. deterministic pass (free, local, walls applied)
//   2. editorial pass (optional) — ONLY prose is sent to the provider
//   3. auto-apply the safe `auto` tier, producing fixedHtml
// `provider` is any AIProvider (or null for deterministic-only). The engine
// never knows whether SRM's key or the client's is behind it.
export async function analyzeItem(html, jig, provider = null, opts = {}) {
  const { parseHTML = defaultParseHTML, maxChars = 12000, signal } = opts;

  const { issues: detIssues, words } = runDeterministic(html, jig, parseHTML);
  let issues = detIssues;

  if (provider) {
    const prose = getProseText(html, jig.protect || {}, parseHTML);
    const text = prose.length > maxChars ? prose.slice(0, maxChars) + "\n[truncated]" : prose;
    const aiRaw = await provider.callEditor(text, jig, { signal });
    const aiIssues = (aiRaw || []).map((x, k) => ({
      id: "ai-" + k,
      source: "ai",
      ruleId: "editorial-pass",
      type: x.type || "editorial",
      category: x.type || "editorial",
      tier: "suggest",
      severity: x.severity || "error",
      flagged: x.flagged,
      context_before: x.context_before || "",
      context_after: x.context_after || "",
      explanation: x.explanation,
      suggestion: x.suggestion ?? null,
      fixed: false,
      fixFailed: null,
    }));
    issues = issues.concat(aiIssues);
  }

  // Auto-apply the safe tier, with undo available later via the original html.
  let fixedHtml = html;
  issues = issues.map((iss) => {
    if (iss.tier === "auto" && iss.suggestion != null) {
      const r = applyFixToHtml(fixedHtml, iss.flagged, iss.context_before, iss.context_after, iss.suggestion, parseHTML);
      if (r.applied) {
        fixedHtml = r.html;
        return { ...iss, fixed: true };
      }
    }
    return iss;
  });

  issues.sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9));
  return { issues, fixedHtml, words };
}
