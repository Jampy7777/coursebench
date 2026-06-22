#!/usr/bin/env node
// Issue a per-client proxy token.
// Usage:
//   node scripts/issue-token.mjs <client_id> "<jig1,jig2>" "<origin1,origin2>" [label]
//
// Prints the plaintext token ONCE (give it to the client), plus the SQL to
// insert its hash. The plaintext is never stored anywhere.

import crypto from "node:crypto";

const [, , clientId, jigsArg = "", originsArg = "", label = ""] = process.argv;
if (!clientId) {
  console.error('Usage: node scripts/issue-token.mjs <client_id> "<jigs>" "<origins>" [label]');
  process.exit(1);
}

const token = "cb_" + crypto.randomBytes(24).toString("base64url");
const hash = crypto.createHash("sha256").update(token).digest("hex");
const arr = (s) => "{" + s.split(",").map((x) => x.trim()).filter(Boolean).map((x) => `"${x}"`).join(",") + "}";

console.log("\n  TOKEN (give to the client — shown once):\n");
console.log("    " + token + "\n");
console.log("  SQL to register it:\n");
console.log(
  `    insert into client_tokens (token_hash, client_id, label, allowed_jigs, allowed_origins)\n` +
  `    values ('${hash}', '${clientId}', '${label}', '${arr(jigsArg)}', '${arr(originsArg)}');\n`
);
