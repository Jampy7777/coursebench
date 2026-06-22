// DOM adapter. The engine is browser-first: by default it uses the native
// DOMParser. Tests inject a jsdom-backed parser instead. Keeping the parser
// injectable means the engine bundle never imports jsdom.

export function defaultParseHTML(html) {
  // Browser runtime. (In Node tests, a jsdom parser is injected instead.)
  return new DOMParser().parseFromString(html || "", "text/html");
}

// Collect every text node under <body>, in document order.
export function getTextNodes(doc) {
  const root = doc.body || doc.documentElement;
  const NF = (doc.defaultView && doc.defaultView.NodeFilter) || globalThis.NodeFilter;
  const SHOW_TEXT = (NF && NF.SHOW_TEXT) || 4; // spec value for SHOW_TEXT
  const walker = doc.createTreeWalker(root, SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}
