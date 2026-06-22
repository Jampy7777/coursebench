// Shared Anthropic helpers. Transport-agnostic: used identically whether the
// call goes direct (client key) or through the proxy (SRM key). The only thing
// the two providers differ on is the request envelope; the prompt and the parse
// are the same.

export const DEFAULT_MODEL = "claude-sonnet-4-6";

/** Build the editorial system prompt from a jig's `ai` rule. */
export function buildSystemPrompt(jig) {
  const ai = (jig?.issues || []).find((i) => i.engine === "ai");
  if (!ai) return "";
  return (
    ai.instruction +
    "\n\nReturn ONLY a JSON array (no prose, no markdown fences). Each item: " +
    '{"type":"grammar"|"usage"|"spelling"|"clarity","severity":"error"|"warning",' +
    '"flagged":"verbatim text under 10 words","context_before":"3-5 verbatim words before, or empty",' +
    '"context_after":"3-5 verbatim words after, or empty","explanation":"one sentence",' +
    '"suggestion":"direct replacement for flagged"}. Return [] if clean.'
  );
}

/** Build the Anthropic Messages request body (used by the direct path, and by
 *  the Worker on the proxy path). */
export function buildBody(text, jig, model, maxTokens) {
  return {
    model: model || DEFAULT_MODEL,
    max_tokens: maxTokens || 4096,
    system: buildSystemPrompt(jig),
    messages: [{ role: "user", content: "Check this educational content:\n\n" + text }],
  };
}

/** Parse an Anthropic (or proxy-relayed) response into validated Issue[]. */
export async function parseResponse(resp) {
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error("AI request failed " + resp.status + ": " + body.slice(0, 160));
  }
  const data = await resp.json();
  const raw = (data.content || []).map((b) => b.text || "").join("");
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  let arr;
  try {
    arr = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => x && x.flagged && x.explanation)
    .map((x) => ({
      type: x.type || "editorial",
      severity: x.severity || "error",
      flagged: x.flagged,
      context_before: x.context_before || "",
      context_after: x.context_after || "",
      explanation: x.explanation,
      suggestion: x.suggestion ?? null,
    }));
}
