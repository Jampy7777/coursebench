import { defaultParseHTML, getTextNodes } from "./dom.js";

// The walls. Returns the editable prose of a page: the text content of every
// DOM text node that is NOT inside a protected region, with inline protected
// patterns (URLs, $math$, emails) masked out. Anything not returned here is
// never shown to a detector rule or to the AI.
export function getProseText(html, protect = {}, parseHTML = defaultParseHTML) {
  const doc = parseHTML(html || "");
  const sel = (protect.selectors || []).join(",");
  const parts = [];
  for (const n of getTextNodes(doc)) {
    if (sel && n.parentElement && n.parentElement.closest(sel)) continue; // protected region
    parts.push(n.textContent);
  }
  let text = parts.join(" ").replace(/\u00a0/g, " ");
  for (const pat of protect.patterns || []) {
    text = text.replace(new RegExp(pat, "g"), (m) => " ".repeat(m.length)); // mask, preserve offsets
  }
  return text;
}
