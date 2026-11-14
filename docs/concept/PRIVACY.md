# Data privacy: what Mandate sends, stores and shows

**In short.** Mandate handles purchasing data: products, quantities, delivery days, budgets, approvals. It has no field for a person's name, email, phone or address (no such field exists in `src/lib/core/contracts/`). What a chef types is the one free text that leaves the system: it goes verbatim, capped at 500 characters, to Google Gemini. Product names and GTINs go to Exa for web lookups. Valio's API gets product ids, a date and the fixed challenge customer number `123`. App and database run in AWS `eu-central-1` (Frankfurt) on Aiven (docs/foundations/deploy.md:3, docs/STATUS.md:7). Nothing is ever deleted: a reset starts a new run and keeps the old one.

## Data → where it goes → why → evidence

| Data | Where it goes | Why | Evidence |
|---|---|---|---|
| Product ids, requested date, customer `123`, API key in a header | Valio Aimo API (`junction26.valioaimo.fi`) | Live price and availability; no order is ever sent to Valio | adapters/catalog/valio-live.ts:66-67, 110-113; valio.ts:162 |
| Chef's chat message (≤500 chars, verbatim) + today's date | Gemini Flash-Lite | Read what the chef wants | chat/understand.ts:142-146; routes/api/chat/turn/+server.ts:41 |
| `/request` text (≤500 chars, verbatim) + date | Gemini Flash-Lite | Parse items, amounts, delivery day | request/parse.ts:576-577; routes/request/run/+server.ts:60 |
| Chef's question (≤300 chars) + plan facts (need labels, amounts, euros committed) | Gemini Flash-Lite | Answer "why?" in words | chat/explain.ts:30-48, 130-135 |
| Event brief: title, date, guest count, diets, budget, free-text notes | Gemini 3.8 Flash | Propose a menu | menu/proposal.ts:329-341; adapters/llm/router.ts:56 |
| Goal, kitchen ids and names, open plan ids, tool results as typed facts | Gemini (only with `AGENT_PLANNER=llm`; prod runs the scripted planner) | Agent picks its next tool | agent/loop.ts:830-837; agent/types.ts:98-99; docs/STATUS.md:24 |
| Dish, planned product, candidate names, hard constraints; request text or goal + summary for reviews | Gemini Decisions (`gemini-decision-1`) | Substitute fit, constraint check, output review | adapters/decide/index.ts:231; core/services/substitutes.ts:79-110; review/parse.ts:95-97; review/outcome.ts:95-96 |
| Product name + GTIN + optional question (≤200 chars); a "need" or dish name | Exa search | Ingredient/allergen facts, recipes when Valio has nothing | web/lookup.ts:155-158, 338-343; web/grounding.ts:88-91; web/tools.ts:118-123 |
| Supplier (vendor) names from the plan; public recall page URLs | Context.dev | Supplier news, Finnish Food Authority recall notices | web/contextdev.ts:42-50, 207-211; web/evidence.ts:250-267; web/recall.ts:88 |
| Visitor's IP and user agent (by the browser) | Google Fonts | Page fonts | routes/+layout.svelte:70-74 |

Featherless (Gemma) is wired as an optional provider but only used when `LLM_PROVIDER=featherless` (adapters/llm/index.ts:136-145). The default is the fixture, which makes no network call (index.ts:122-133). Gemini text calls set `store: false` (adapters/llm/index.ts:72); the Decisions call sets no such flag (decide/index.ts:231).

## What is stored, and where (Postgres on Aiven)

- **Op log** `ops`: every state change with actor kind, actor label, channel and time; append-only (db/schema.ts:179-197).
- **Plans, approvals, orders, budgets, menu proposals** as JSON documents per workspace (schema.ts:99-162, 239-261). Menu proposals hold the brief, notes included.
- **Tasks** `agent_tasks`: the chef's words verbatim as `title` (≤200 chars) and `requirement.goal` (≤500) (chat/turn.ts:242, 247; request/run.ts:691-694; schema.ts:264-281).
- **Web state**: `web_cache` (provider responses under a SHA-256 key of the request; external/call.ts:51, 101), `web_spend` (daily call counts per workspace), `web_findings` (a finding without a workspace is a public recall notice), `web_queue`, `web_applications` (schema.ts:287-344). `offer_cache` holds Valio responses (schema.ts:72-83).
- **Traces** (model, tokens, latency, first 160 chars of a decision question) stream to open screens of that workspace and are not written to tables (adapters/llm/trace.ts:15-29; decide/index.ts:237-240; bus/memory.ts:6-13). The console line has model, tokens and latency only, never prompt text (trace.ts:32-36).
- **Cookies**, all `httpOnly`: `mandate_visitor` (signed sandbox id, 14 days) and `mandate_room` (demo/visitor.ts:25-29, 43); `kitchen_sid` (random id, 1 day, kitchen/sid.ts:8-13); `mandate_presenter` (HMAC token, 12 h, `sameSite=strict`; routes/ops/+page.server.ts:136-141, demo/presenter.ts:16).

## Isolation and access

- Each browser gets its own sandbox `ws-j-<96 random bits>`, reached only through an HMAC-signed cookie; an id in a link is ignored (demo/visitor-id.ts:1-16, 44-55; visitor.ts:1-14). Reads are allowed for your own sandbox and the public rooms only (visitor.ts:61-66).
- Judge keys are stateless HMACs of one sandbox id with an expiry (end of event), checked in constant time; they act as an external agent with `read, plan, order` and never `approve` (demo/judge-key.ts:1-5, 27-44; core/contracts/tools.ts:20). Ops show `judge-<6 chars>`, never the key (judge-key.ts:52).
- A run acts only for its granted kitchens (`kitchenIds`), and its scopes are the starter's ∩ the agent's, never the union (core/services/handlers.ts:105-113; agent/principal.ts:27-29, 59).
- The presenter session is signed with the chef/approver key, so rotating the key ends it (presenter.ts:28-46).
- Secrets live in `.env` (gitignored, .gitignore:15-17), read only in server modules; keys under 16 characters are refused (auth/index.ts:52-53). Public fixture keys (`fx-chef`…) work only in dev or with `MANDATE_FIXTURE_KEYS=1` (auth/index.ts:35-40, 72).

## What we never send or store

- No personal fields: no names, emails, phone numbers or addresses in any contract.
- No API key, cookie or judge key goes into a prompt, a trace or a log line.
- Nothing is sent to Valio but product ids, a date and the challenge's demo customer number; no order leaves the system.
- No purchasing data in browser storage: only the open chat task id (sessionStorage) and the /ops view choice (localStorage) (ui/chat/ChatDock.svelte:71-79; routes/ops/+page.svelte:120-129).

## Gaps and what production would add

1. **Free text goes verbatim to Gemini.** If a chef types a name or phone number, it reaches Google. Production: redact PII before model calls, and a DPA with the model provider. The repo documents no Google training or retention terms, so we claim none.
2. **No retention limit.** Ops, plans, tasks (with the chef's words), menu proposals and web cache rows are never deleted; a sandbox reset keeps the old run "for audit" (demo/sandbox.ts:25). The only deletes are web queue/findings housekeeping (web/pg-state.ts:50-53). Production: retention periods and a delete-on-request path per kitchen.
3. **Shared rooms are shared.** Anything typed in `ws-judges`, or by a visitor past the 300-sandbox cap (who lands there), is readable by every visitor (visitor.ts:28, 105-108).
4. **Judge keys can travel in the URL** (`/mcp/k/<key>`, auth/index.ts:10-11), so they may appear in host access logs. They expire at the event's end.
5. **Exa and Context.dev queries** carry product names and a chef's optional question; responses are kept in `web_cache` (reused for a day, never deleted; web/http.ts:36, 41).
6. **Hosting region** is Frankfurt, not Finland; an older decision mentions a Finnish region (DECISIONS.md D3), which deploy.md supersedes.
