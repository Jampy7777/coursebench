# Coursebench

Canvas course-content tool suite, hung off the SRM site (coursebench.sixredmarbles.com).
Stages: **Gather → Polish → Convert → Publish**. A client's config is their **jig**.
First build: the **Polish** copy-edit workflow.

## Architecture in one line

A generic engine runs in the user's browser session; per-client **jigs** (configs)
drive it; the AI editorial pass routes through a swappable **provider** so it can use
either SRM's key or the client's key.

## Provider model (the "either key" seam)

The engine calls one interface — `callEditor(text, jig) -> Issue[]` — and never
touches Anthropic, a proxy, or a key directly.

| keyMode  | provider | transport | where the key lives |
|----------|----------|-----------|---------------------|
| `client` | Direct   | browser → Anthropic | the client's browser (never sent to SRM) |
| `srm`    | Proxy    | browser → Cloudflare Worker → Anthropic | a Worker secret (never in a browser) |

Rule: client keys go direct; SRM's key goes via proxy. Never cross them.

## Layout

```
src/providers/   anthropic.js  shared prompt/body/parse
                 direct.js     client-key path
                 proxy.js      SRM-key path
                 index.js      selectProvider() + interface contract
test/            providers.test.js
```

## Phases

- [x] **Phase 0** — setup + provider interface
- [x] **Phase 1** — engine hardened (detector, protect walls, fix application) as tested modules
- [x] **Phase 2** — orchestrator + UI wired to modules; client-key path live, no backend
- [x] **Phase 3** — proxy for the SRM-key path (Cloudflare Worker + Supabase) — see CHECKLIST.md
- [ ] **Phase 4** — mode selection, jigs, hosting, compliance

## Build & deploy

```
npm install            # once
npm run build          # → dist/
wrangler pages deploy dist   # upload the folder (or drag dist/ into the Pages dashboard)
```

The Worker (proxy) deploys separately: `wrangler deploy` (see CHECKLIST.md).
So it's one repo, two Cloudflare targets: Pages (static dist/) and Workers (proxy).

## Infra (not needed until Phase 3)

- **Cloudflare Workers** — the proxy: SRM key as a secret, token + origin auth,
  rate-limit, no body logging, ZDR Anthropic call.
- **Cloudflare Pages/R2 + CDN** — host engine.js, jigs, loader; origin gating *(Phase 4)*.
- **Supabase** — per-client tokens, jig storage/versioning, content-free telemetry *(Phase 3)*.
