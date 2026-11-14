# Mandate

A purchasing agent for professional kitchens, built on Valio Aimo's catalogue for the Junction 2026 "Trusted Trade Agents" challenge.
It plans a kitchen's order from the menu, ranks substitutes when products run out, and orders on its own only inside limits the chef sets (the mandate).
Anything outside those limits waits for a person. An approval covers the exact terms the person saw, and every decision is traced.

**Live:** https://app.mandate.kitchen (fallback: https://widely-many-scorpion.eur-1.aiven.app) · site: https://mandate.kitchen · MIT licensed

## A 2-minute tour
Each visitor gets a private sandbox, so nothing you do affects anyone else.

1. **Kitchen** (`/`): a hotel's Christmas buffet for 140 guests on Saturday. Whole ham and lanttulaatikko are out in Valio's data. Change the grams per guest for a dish; its packs and its status update.
2. **Look at what it refused.** Open a dish's Why: candidates are ranked known stock first. Ham moves to HK Palvikinkku `476768`, and lanttulaatikko is made in house from orderable ingredients. Products whose supply Valio doesn't state are labelled unknown, never counted as covered, and held for one approval.
3. **Approve, then try to break it.** Approve the held lines, per reason group, and place the order. A retry gives the same receipt, not a second order. The chef can approve from the chat dock's decision card too, on the same terms; no agent, key or model can approve.
4. **Operations** (`/ops`): Valio's side. The same held lines, grouped by cause, in your sandbox.
5. **Valio's own example** (`/request`): "1,000 L lactose-free milk by Monday" → lookup → order → approval. A too-late date names the cut-off and offers the next delivery day. An event brief ("Christmas dinner for 50") gives a proposed menu that becomes a plan.
6. **Connect your own agent** (`/agents`): get a key for your sandbox (below).

## Connect an agent over MCP
Open `/agents` to mint a key bound to your sandbox. The page shows your URL; it looks like `https://app.mandate.kitchen/mcp/k/<your-key>`.

```sh
claude mcp add --transport http mandate https://app.mandate.kitchen/mcp/k/<your-key>
```

Any MCP client that speaks Streamable HTTP:
```json
{ "mcpServers": { "mandate": { "type": "http", "url": "https://app.mandate.kitchen/mcp/k/<your-key>" } } }
```

Start with `get_context`. Your agent can read, plan and order within the mandate. It has no `approve` or `set_mandate` tool and gets 403 if it calls them over REST: only a person approves. The same tools are on REST at `/api/tools/<name>` (schema at `/api/openapi.json`); the agent card is at `/.well-known/agent.json`.

## What is real and what is simulated
| Real | Simulated or estimated (labelled on screen) |
|---|---|
| Valio's mock catalogue, prices and availability, read live through a cache (`fetched` / `cached` labels); availability of 999999 or more read as unknown, as Valio confirmed | The booking, the December clock and the kitchen's stock on hand (scenario) |
| The rules: caps, the hard limit, approvals bound to exact terms, cut-offs, one receipt per order (tests + a race check on the deployed Postgres) | Orders are local simulated commitments; nothing is sent to Valio |
| Gemini for reading requests and chat, proposing menus and ranking fit, with replay and rules fallbacks | Recipes, grams per guest and menu amounts (team or model estimates) |
| Per-visitor sandboxes and keys; the outside-agent limits above (checked on the deployed app) | Salmon contention and shifted cut-offs (simulated overlays); the "normal week" a plan is compared with (team estimate) |
| Postgres on Aiven; web lookups through Exa and Context.dev with daily caps | The recall that holds a line (a labelled drill) |

Not claimed: data stays in Finland (it runs in the EU, Frankfurt); "recipe-aware" ranking (no labelled test set has run); a real recall hitting real orders; reading photos (the `read_image` tool exists, but its vision endpoint isn't live). The full claim ledger with evidence is in [docs/CLAIMS.md](docs/CLAIMS.md).

## Architecture in six lines
- One SvelteKit 2 app (Svelte 5, Tailwind 4, d3) in one Node container on Aiven Runtime, with Postgres on Aiven.
- The browser, the in-app agent, the chat, REST and MCP all call one tool registry; browsers never hold a key.
- Every change goes through one path: check the caller's scopes → idempotency → fetch prices and scores outside the lock → lock the workspace → `applyOps` → write state and the op log → notify (SSE).
- `src/lib/core/` is plain TypeScript with no I/O: rules, ranking, planning and the state machines live there and are unit-tested.
- Outside services sit behind ports, each with a fixture: catalogue (Valio), decide (Gemini Decisions → replay → rules), LLM (Gemini 3.5 Flash-Lite for parsing, chat and explanations; Gemini 3.8 Flash for menus), web (Exa, Context.dev), store (Postgres, or PGlite in tests). The in-app agent plans its tool calls with a deterministic script.
- Every op records who did it (chef, kitchen agent, outside agent, approver), through which door, and what allowed it.

More: [docs/concept/ARCHITECTURE.md](docs/concept/ARCHITECTURE.md) · [docs/concept/CONCEPT.md](docs/concept/CONCEPT.md) · [docs/DECISIONS.md](docs/DECISIONS.md)

## Run it locally
Needs Node 24 and pnpm 10.

The catalogue is Valio's hackathon dataset, which isn't published and which we can't redistribute. The dev server's fixture mode, the evals and `pnpm gate` all read it from `data/valio/` (layout in [docs/foundations/valio-data.md](docs/foundations/valio-data.md)); without it, use the deployed app.

```sh
pnpm install
pnpm dev            # http://localhost:5173: in-memory PGlite and recorded model answers, no keys needed
pnpm gate           # type check, lint, 600+ tests, scenario and agent evals
pnpm build && node build
```

With no `.env` the app uses fixtures for the database, the model and web lookups. Copy `.env.example` to `.env` to use real services; it lists names only.

## Data and licence
Product data, prices and availability come from the Valio Aimo mock catalogue and API provided for the challenge. The repo holds only small derived samples (`fixtures/seeds/`, `evals/`); the full dataset is not redistributed. Venue data © OpenStreetMap contributors (ODbL). Code is MIT.

Built at Junction 2026, Espoo, 13–15 Nov 2026.
