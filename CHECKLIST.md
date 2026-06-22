# Coursebench Proxy — Provisioning Checklist (Phase 3)

Do these in order. Everything code-side is built and tested; this is the infra you set up.

## 1. Supabase
1. Create a project. Note the **Project URL** and the **service_role key** (Settings → API).
2. SQL editor → run `supabase/schema.sql`.
3. Create a client row:
   `insert into clients (name) values ('Old Dominion University') returning id;`
4. Issue a token (plaintext shown once — hand it to the client/deployment):
   `node scripts/issue-token.mjs <client_id> "srm-house-style" "https://canvas.odu.edu" "ODU prod"`
   Run the SQL it prints to register the hash.

## 2. Anthropic
1. Use a **commercial org API key** (commercial terms = no training on your data).
2. Apply for **Zero Data Retention** on the org (so the Anthropic leg retains nothing at rest).
3. Have the DPA ready (Anthropic offers one for commercial customers).

## 3. Cloudflare Worker
1. `npm i -g wrangler` (or `npx wrangler`).
2. Edit `wrangler.toml`: set `SUPABASE_URL` and (Phase 4) the real `JIG_BASE_URL`.
3. Secrets:
   `wrangler secret put ANTHROPIC_API_KEY`  (the SRM commercial key)
   `wrangler secret put SUPABASE_SERVICE_KEY`  (from step 1)
4. `wrangler deploy`. Note the Worker URL → this is the **proxyEndpoint**.
5. Bind a route, e.g. `proxy.coursebench.sixredmarbles.com`.
6. Add a **Rate Limiting** rule on the route (or wire a Durable Object/KV counter
   into `deps.checkRateLimit`).

## 4. Wire the client
Set the UI's SRM-key mode config:
```
selectProvider({
  keyMode: "srm",
  proxyEndpoint: "https://proxy.coursebench.sixredmarbles.com",
  clientToken: "<the token from step 1.4>",
  jigId: "srm-house-style",
})
```
(The client-key path needs none of this — it stays direct.)

## 5. Compliance (run in parallel)
- DPA + FERPA "school official" designation with each institution on the proxy path.
- One-page data-flow diagram (browser → Worker → Anthropic; no storage; ZDR).
- FERPA scoping decision: on the proxy path, exclude student-authored discussion
  content (the Polish UI already warns when a ZIP contains Discussions).

## What the proxy guarantees (verified by `test/proxy.test.js`)
- SRM's key is used server-side only; never in a response or log.
- The client cannot supply a system prompt; the Worker builds it from the jig.
- Tokens are matched by SHA-256 hash; plaintext is never stored or logged.
- Origin and jigId are gated; telemetry contains no request/response text.
