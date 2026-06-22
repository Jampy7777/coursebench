import { defaultParseHTML, getTextNodes } from "./dom.js";

// Surgical, context-aware fix application. Walks text nodes and replaces the
// flagged text using surrounding context to disambiguate repeats. Returns
// { html, applied, reason? }. Never edits attributes or protected regions
// because it only ever touches text-node content.
export function applyFixToHtml(html, flagged, contextBefore, contextAfter, suggestion, parseHTML = defaultParseHTML) {
  if (!html || !flagged || suggestion == null) return { html, applied: false, reason: "missing input" };
  const doc = parseHTML(html);
  const textNodes = getTextNodes(doc);
  const cb = (contextBefore || "").trim();
  const ca = (contextAfter || "").trim();

  // Strategy 1: exact context match inside one text node
  if (cb && ca) {
    const search = cb + " " + flagged + " " + ca;
    const repl = cb + " " + suggestion + " " + ca;
    for (const tn of textNodes) {
      const idx = tn.textContent.indexOf(search);
      if (idx !== -1) {
        tn.textContent = tn.textContent.slice(0, idx) + repl + tn.textContent.slice(idx + search.length);
        return { html: doc.documentElement.outerHTML, applied: true };
      }
    }
    // Strategy 2: loose-whitespace context match, then replace flagged once
    const norm = (s) => s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const target = norm(search);
    for (const tn of textNodes) {
      if (norm(tn.textContent).includes(target)) {
        const fIdx = tn.textContent.indexOf(flagged);
        if (fIdx !== -1) {
          tn.textContent = tn.textContent.slice(0, fIdx) + suggestion + tn.textContent.slice(fIdx + flagged.length);
          return { html: doc.documentElement.outerHTML, applied: true };
        }
      }
    }
  }

  // Strategy 3: flagged appears exactly once across all nodes
  let total = 0, matchNode = null;
  for (const tn of textNodes) {
    const c = tn.textContent.split(flagged).length - 1;
    total += c;
    if (c > 0 && !matchNode) matchNode = tn;
  }
  if (total === 1 && matchNode) {
    const idx = matchNode.textContent.indexOf(flagged);
    matchNode.textContent = matchNode.textContent.slice(0, idx) + suggestion + matchNode.textContent.slice(idx + flagged.length);
    return { html: doc.documentElement.outerHTML, applied: true };
  }
  if (total === 0) return { html, applied: false, reason: "text not found (may already be fixed)" };
  return { html, applied: false, reason: "ambiguous — " + total + " matches, context did not disambiguate" };
}
