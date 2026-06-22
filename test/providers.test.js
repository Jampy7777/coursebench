import assert from "node:assert";
import { selectProvider, createDirectProvider, createProxyProvider } from "../src/providers/index.js";
import { parseResponse } from "../src/providers/anthropic.js";

const jig = { issues: [{ engine: "ai", instruction: "Edit conservatively." }] };

function fakeResp(obj, ok = true, status = 200) {
  return { ok, status, async json() { return obj; }, async text() { return JSON.stringify(obj); } };
}

let captured;
const fetchImpl = async (url, opts) => {
  captured = { url, opts, body: JSON.parse(opts.body) };
  return fakeResp({
    content: [{ type: "text", text: '```json\n[{"type":"usage","flagged":"affect","explanation":"wrong word","suggestion":"effect"}]\n```' }],
  });
};

// 1) selector routes by keyMode and rejects bad input
assert.equal(selectProvider({ keyMode: "client", clientApiKey: "sk-x" }).mode, "client-key");
assert.equal(
  selectProvider({ keyMode: "srm", proxyEndpoint: "https://p", clientToken: "t", jigId: "srm-house-style" }).mode,
  "srm-key"
);
assert.throws(() => selectProvider({ keyMode: "nope" }));

// 2) direct (client-key): sends the client key + full body incl. system prompt
const direct = createDirectProvider({ apiKey: "sk-client" });
let issues = await direct.callEditor("He affect the outcome.", jig, { fetchImpl });
assert.equal(captured.url, "https://api.anthropic.com/v1/messages");
assert.equal(captured.opts.headers["x-api-key"], "sk-client");
assert.ok(captured.body.system.includes("Edit conservatively."));
assert.equal(issues[0].suggestion, "effect");

// 3) proxy (SRM-key): sends bearer + {jigId,text}; NEVER a key or a system prompt
const proxy = createProxyProvider({ endpoint: "https://proxy.example", clientToken: "client-tok", jigId: "srm-house-style" });
issues = await proxy.callEditor("He affect the outcome.", jig, { fetchImpl });
assert.equal(captured.url, "https://proxy.example");
assert.equal(captured.opts.headers["Authorization"], "Bearer client-tok");
assert.equal(captured.body.jigId, "srm-house-style");
assert.equal(captured.body.text, "He affect the outcome.");
assert.ok(!("x-api-key" in captured.opts.headers), "SECURITY: proxy must not send any key");
assert.equal(captured.body.system, undefined, "SECURITY: proxy must not send a system prompt");
assert.equal(issues[0].suggestion, "effect");

// 4) parseResponse strips fences and validates shape
const parsed = await parseResponse(fakeResp({ content: [{ text: '[{"flagged":"teh","explanation":"typo","suggestion":"the"}]' }] }));
assert.equal(parsed[0].flagged, "teh");

// 5) parseResponse surfaces API errors
await assert.rejects(() => parseResponse(fakeResp({ error: "bad" }, false, 401)));

console.log("All provider tests passed \u2713");
