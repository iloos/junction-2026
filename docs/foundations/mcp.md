# MCP gateway: server, tools, MCP Apps, OpenAPI

_Foundation note, Sat 14 Nov. Versions checked with `npm view` today. Spike: `scratch/spikes/mcp/` (`npm i && npm start`, then `npm run client`; `npm test`; `npm run openapi`). Everything below marked **(spiked)** ran there._

_As built: the tool table in §2 and decisions 2–5 below were the pre-build proposal. The registry is 20 tools in `src/lib/core/contracts/tools.ts` (an outside key sees 17; see [ARCHITECTURE § Tools](../concept/ARCHITECTURE.md#tools-corecontractstoolsts)), served by `src/lib/server/tools/mcp.ts` and REST `/api/tools/<name>` + `/api/openapi.json`; scopes are `read · plan · order · approve · mandate:write · agent:run`. The MCP Apps approval card (§3) is not built: approval goes through `approvalUrl` to a human (D17)._

## Versions
| Package | Version | Note |
|---|---|---|
| `@modelcontextprotocol/server` / `client` | **2.4.0** | v2 split of the old `sdk` (1.32.2, don't use). Implements spec 2026-07-28; still serves 2025 clients. Deps: zod ^4.2 only. |
| `@modelcontextprotocol/ext-apps` | **2.0.4** | MCP Apps. `react` and `server` are optional peers. `app-with-deps` bundle is 542 kB. |
| `@modelcontextprotocol/inspector` | 2.15.0 | `--web` (default), `--cli`, `--tui` |
| `zod-openapi` | 6.0.2 | zod ^4 peer. Alternative `@asteasolutions/zod-to-openapi` 9.1.0 (also zod 4). |
| `@modelcontextprotocol/node` | 2.1.2 | Not needed: SvelteKit already gives us a `Request`. |

## 1. Hosting in SvelteKit (stateless Streamable HTTP)
v2 has a Web-standard handler, so no adapter is needed: `createMcpHandler(factory, opts).fetch(request, { authInfo })` returns a `Response`. The factory runs **once per request** (stateless by design). With `legacy: 'stateless'` (the default) 2025-era clients (`initialize` with `2025-06-18`) are also answered **(spiked with curl)**; GET/DELETE get 405. This works the same on adapter-node and adapter-vercel.

```ts
// src/routes/mcp/+server.ts  (sketch; real code after contracts)
const handler = createMcpHandler(({ authInfo }) => buildServer(authInfo), { responseMode: 'json' });
const handle: RequestHandler = async ({ request }) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const caller = checkKey(request);              // our static keys, see Auth
  if (!caller) return new Response('{"error":"invalid_token"}', { status: 401, headers: { ...CORS, 'www-authenticate': 'Bearer' } });
  return withCors(await handler.fetch(request, { authInfo: caller }));
};
export const POST = handle, GET = handle, DELETE = handle, OPTIONS = handle;
```
- **Sessions: no.** State lives in our store and is passed as handles (`planId`, `orderId`). No `mcp-session-id`, so any instance can answer.
- `responseMode: 'json'` drops progress notifications (it logs a warning once). Use `'auto'` if we want progress on `plan_event`.
- **Auth:** `requireBearerAuth` / `verifyBearerToken` exist, but they reject tokens without an expiry. For static keys, check them ourselves: `MCP_KEYS="judge:…,swarm:…,kitchen-app:…"` in `.env`, mapped to `{ clientId, scopes }` and passed as `authInfo`. Tools read it from the factory argument (or `ctx.http.authInfo`). **Also accept the key in the path** (`/mcp/k/<key>`), because claude.ai's header option is beta (see §5).
- **CORS:** Claude and ChatGPT call from their servers, so CORS doesn't matter for them. Browser clients (Inspector web, our own pages) need it: allow `*`, methods `GET, POST, DELETE, OPTIONS`, headers `authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id`, and expose `mcp-session-id, mcp-protocol-version, www-authenticate`. Allowing `*` is safe because auth is a bearer key, not a cookie. SvelteKit's CSRF check only blocks form content types, so JSON-RPC passes.
- The handler doesn't validate `Host`/`Origin`. That's fine on a public HTTPS host; for local dev, use `hostHeaderValidationResponse(req, [...])`.

## 2. Tools as domain verbs
One zod object per tool in `src/lib/core/contracts/tools.ts` (pure core). `registerTool(name, { title, description, inputSchema, outputSchema, annotations }, cb)` takes **zod v4 objects directly** (Standard Schema). JSON Schema 2020-12 is emitted with enums, min/max and descriptions, and **bad input comes back as `isError: true` with the zod message (spiked)**. Every result sets `structuredContent` (typed) plus a short `content` text, and returns ids, never whole catalogues.

| Tool | In → out (key fields) | Ann. | Leg |
|---|---|---|---|
| `search_products` | query, filters (temperature enum, organic, origin) → `[{productId, name, packUnit, packSize, co2e, reliability}]` | RO | read |
| `get_offers` | productIds ≤50, date → price, availability, cut-off, schedule lines. **Only call to Valio's API**, per line | RO, openWorld | read |
| `find_substitutes` | productId, kitchenId, qty → ranked `[{productId, score, tradeOffs[], reasons[]}]` | RO | read |
| `plan_order` | kitchenId, menuId, covers, week → `planId` + lines summary | write (draft) | plan |
| `plan_event` | kitchenId, description, guests, date → `planId` (diff vs regular week) | write (draft) | plan |
| `propose_order` | planId, edits[] → `planId`, total, per-line `tier: act\|propose\|signoff` + reasons | write (draft) | plan |
| `place_order` | planId, idempotencyKey → `{status: placed\|pending_approval\|rejected, orderId?, tier, reason, approvalUrl?}` | write, idempotent | **commit** |
| `get_order_status` | orderId → status, lines, approvals | RO | read |
| `explain_decision` | orderId\|planId, lineId? → PROV-shaped record (who, what, why, sources) | RO | read |
| `review_order` (MCP App) | planId → approval card (§3) | RO | read |

Rules:
- **The mandate is code.** `place_order` runs `mandate.check(plan, kitchen)` server-side. Anything over a limit, novel, or breaking a preference returns `pending_approval`. No argument lets the agent skip that.
- **Lethal trifecta.** Untrusted text includes product descriptions, enrichment and manufacturer web data, scraped menus, recall pages, photos, and the adversarial agent's injected description. (a) Tool outputs carry **typed fields only**: free text from untrusted sources goes in a `untrusted: {text, source}` wrapper, is length-capped, and never appears in `description` or `reasons` that we compose. (b) Internal contexts that read untrusted text (enrichment workers, recall reader, photo reader) use a **read-scoped key**: their tool list has no `plan_*`, `propose_order` or `place_order`. Scope is checked in the factory, which registers tools per scope, so unreachable tools are not even listed. (c) There is no exfiltration leg: no tool fetches arbitrary URLs or sends messages. (d) For external agents (a judge's Claude) we can't control their context, so `place_order` above the mandate always needs a **human approval the model can't produce** (§3).
- Annotations: `readOnlyHint` on reads, `idempotentHint` on `place_order`, `openWorldHint` only on `get_offers`. Claude and ChatGPT use them for confirm prompts.

## 3. MCP Apps: the approval card
**Yes, feasible (server side spiked; rendering in a real host not yet tested).** `registerAppResource` serves `ui://mandate/approval-card.html` as `text/html;profile=mcp-app`. `registerAppTool('review_order', { …, _meta: { ui: { resourceUri } } })` makes the host render it with the tool's `structuredContent`. The card's buttons call `app.callServerTool('decide_approval', …)`, a tool with `_meta.ui.visibility: ['app']`. Spike: `app.mjs`, plain JS with no build. The SDK bundle is inlined into the HTML (515 kB), which the default CSP (`connect-src 'none'`, inline scripts allowed) needs.
- **Gotcha: `visibility: ['app']` is host-enforced only.** `decide_approval` still appears in `tools/list` (spiked). Guard it server-side: `review_order` puts a one-time `approvalNonce` in the **result `_meta`**, which goes to the view but per the spec is "not intended for model context". `decide_approval` requires that nonce. Fallback, always available: `approvalUrl` → our own kitchen-app sign-off screen.
- Hosts: Claude (web/desktop, custom connectors OK, asks "Allow once" to show an app) and ChatGPT (implements the standard; also reads `openai/outputTemplate`). Don't set `_meta.ui.domain`: Claude derives it from the server URL hash, and the per-judge key URLs would break it.
- Effort: **~2 h** for a plain-HTML card plus the nonce guard. A Svelte-built card (vite singlefile, as in `ext-apps/examples/basic-server-svelte`) is +2 h. **Risk: medium.** Host quirks, the iframe size, and resource caching by URI (bump the URI on breaking changes). Keep the `approvalUrl` path as the demo fallback.

## 4. OpenAPI from the same schemas
`zod-openapi` 6 `createDocument({ openapi: '3.1.0', paths: { '/api/v1/tools/<name>': { post: { requestBody, responses } } } })` takes the same zod objects (spiked, 2 kB doc with enums and nullable types). Serve it at `src/routes/openapi.json/+server.ts`. Use a REST mirror route `POST /api/v1/tools/[name]` that calls the **same tool function** (one registry `{name, input, output, run}` drives MCP, REST and OpenAPI). Zero-dependency fallback: `z.toJSONSchema(schema)` per tool and assemble the paths by hand.

## 5. How a judge connects
Needs a public HTTPS URL (the cloudflared tunnel or the deploy); Anthropic and OpenAI connect from their clouds.
- **Claude (claude.ai, any plan; Free allows 1 custom connector):** Customize → Connectors → Add → *Add custom connector* → name + URL → Authentication **No sign-in** → Add. Give each judge `https://<host>/mcp/k/<judge-key>`. The *Request headers* option (`Authorization: Bearer …`) is **beta for limited orgs**, so don't depend on it. In a chat: + → Connectors → toggle on.
- **ChatGPT:** developer mode, then chatgpt.com/plugins → + → *Add custom MCP server* → name, URL (`…/mcp/k/<key>`), auth **none** → accept the risk warning → Create. Plan gating moves around (Plus/Pro may be read-only for write tools; Business gets full). **Test it with a real account before the demo.**
- Claude Code / Inspector: `claude mcp add --transport http mandate https://<host>/mcp --header "Authorization: Bearer <key>"`.

## 6. Testing
- **Inspector CLI (spiked):** `npx @modelcontextprotocol/inspector@2.15.0 --cli http://localhost:8787/mcp --header "Authorization: Bearer <key>" --method tools/call --tool-name search_products --tool-arg query=milk`. Run it without `--cli` for the web UI.
- **vitest, in process with no port (spiked, 3 tests in 0.6 s):** `new StreamableHTTPClientTransport(url, { fetch: (u, i) => handle(new Request(u, i)), requestInit: { headers } })`, where `handle` is the same function the route exports. Test: tool list snapshot, `place_order` over the limit → `pending_approval`, read key can't see `place_order`, a bad key → 401.

## Gotchas
- TS ≥6 needs `"types": ["node"]` in tsconfig for the SDK's `.d.mts` (it references `Buffer`).
- The spike's vitest picked up the repo's root vite config, so it needs its own `vitest.config.mjs`.
- `registerAppTool` writes both `_meta.ui.resourceUri` and the legacy `"ui/resourceUri"` key. That's normal.
- Legacy (2025) clients get SSE responses even with `responseMode: 'json'`; modern ones get JSON.

## Decisions for ARCHITECTURE
1. **Server lives in the app:** `src/routes/mcp/+server.ts` and `src/routes/mcp/k/[key]/+server.ts` → `src/lib/server/mcp.ts` (the factory) → the tool registry in `src/lib/core/contracts/tools.ts` (zod) with handlers calling core + ports. Stateless, no sessions, `responseMode: 'json'`.
2. **Tools:** the 9 verbs + `review_order`/`decide_approval` above. Names are frozen at the contracts commit.
3. **Auth:** static keys per caller in `.env` (`MCP_KEYS`), each with a scope `read | plan | commit`. The tool list is filtered by scope. The key goes in the header or the path. No OAuth.
4. **The mandate gate is in `place_order`**, human approval needs a nonce the model never sees, and `approvalUrl` is always returned.
5. **One registry → MCP + REST `/api/v1/tools/[name]` + `/openapi.json`** (zod-openapi 6).
6. The swarm uses the same MCP endpoint with `swarm` keys against the fixture Valio adapter, which doubles as our load test.

## Open questions
- Does ChatGPT developer mode on our accounts allow write tools (plan tier)? Test with a tunnel tonight.
- Does Claude render our inline-bundle card, and does the `_meta` nonce reach the view in both hosts? (A 30-minute test once the tunnel is up.)
- Path keys show up in logs and proxies. Is that acceptable for a hackathon (rotate after), or add OAuth via a hosted IdP if time allows?
- Do we want `plan_event` progress (SSE `auto` mode) for the demo, or is one JSON response enough?
