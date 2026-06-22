import assert from "node:assert";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { getProseText, runDeterministic, applyFixToHtml } from "../src/engine/index.js";

// Inject a jsdom-backed parser (browser uses native DOMParser).
const parse = (html) => new JSDOM("<!DOCTYPE html>" + html).window.document;
const jig = JSON.parse(fs.readFileSync(new URL("../jigs/srm-house-style.json", import.meta.url)));

const SAMPLE = `
<h2>Welcome to the course.</h2>
<p>Please  send your assignment by e-mail — it isn't just a formality — really — and
submit early. To begin, <a href="/start">click here</a>.</p>
<pre><code>contact = "e-mail" —— do not flag these tokens</code></pre>
`;

// 1) Walls: prose includes the prose e-mail, excludes the protected code block
const prose = getProseText(SAMPLE, jig.protect, parse);
assert.ok(prose.includes("by e-mail"), "prose e-mail should be visible");
assert.ok(!prose.includes("do not flag"), "WALL: code block content must be excluded");

// 2) Detection
const { issues } = runDeterministic(SAMPLE, jig, parse);
const byRule = (id) => issues.filter((x) => x.ruleId === id);

assert.equal(byRule("term-email").length, 1, "should flag the one prose e-mail");
assert.equal(byRule("term-email")[0].flagged, "e-mail");
assert.ok(byRule("click-here").length >= 1, "should flag non-descriptive link text");
assert.ok(byRule("tell-em-dash").length >= 1, "should flag em-dash overuse in prose");
assert.ok(byRule("tell-not-x-y").length >= 1, "should flag the it's-not-X flourish");

// The decisive one: the only straight quotes live in an href attribute and the
// protected code block. Scanning text nodes (not raw HTML) means ZERO matches —
// the v2 false positive is gone.
assert.equal(byRule("straight-double-quote").length, 0, "must NOT flag quotes in attributes or code");

// 3) Fix application: fix the prose e-mail, leave the code block's e-mail intact
const em = byRule("term-email")[0];
const r = applyFixToHtml(SAMPLE, em.flagged, em.context_before, em.context_after, em.suggestion, parse);
assert.ok(r.applied, "fix should apply: " + (r.reason || ""));
assert.ok(r.html.includes("by email"), "prose e-mail should become email");
assert.ok(r.html.includes('"e-mail"'), "WALL: code block e-mail must be untouched");

// 4) Not-found is reported, not silently mangled
const nf = applyFixToHtml(SAMPLE, "zzz", "", "", "qqq", parse);
assert.ok(!nf.applied && /not found/.test(nf.reason), "missing text should report not-found");

console.log("All engine tests passed \u2713");
