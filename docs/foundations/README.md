# Foundations phase

_Between the concept (CONCEPT v2.1, SCORECARD) and the lanes. Goal: every service and the experience are understood and proven before contracts freeze, so lanes slot services in behind ports instead of discovering them._

## Steps
1. **Per-service foundations (parallel).** One note per service in this folder: current API and versions, a tiny live check, limits and cost, how it fits our port, the fixture fallback, gotchas, open questions. Spike code lives in `scratch/spikes/`, never in `src/`.
2. **Experience foundation (parallel).** Interaction model, key screens, control room, design direction: [ux.md](ux.md).
3. **Shape review.** ARCHITECTURE.md + contracts draft, then a clean-context adversarial review of CONCEPT + ARCHITECTURE + SCORECARD + UX. Iterate once.
4. **Contracts commit** (types, op schemas, port interfaces + fixtures, MCP tool names, lint rule for `core/`, eval scenarios, lane briefs). Then lanes fan out.

## Notes
| Note | Covers | Status |
|---|---|---|
| [gemini.md](gemini.md) | Decisions API (calibrated decisions), Live API, models, SDK | [x] |
| [models.md](models.md) | Nemotron 3.5 Super VL (Verda / NVIDIA Build), Gemma (Featherless / Verda), one LLM port | [ ] |
| [modal.md](modal.md) | Fan-out batch (catalogue enrichment), swarm runner, Sandboxes, web endpoints | [x] |
| [data.md](data.md) | Aiven Postgres + pgvector + LISTEN/NOTIFY, Drizzle, PGlite fixture, Aiven Runtime | [ ] |
| [mcp.md](mcp.md) | MCP server (SDK v2) inside SvelteKit, MCP Apps, OpenAPI from zod, testing with Inspector | [x] |
| [web.md](web.md) | Context.dev (menus, manufacturer data, recall monitor), Exa, caching | partly: [../research/menu-spike.md](../research/menu-spike.md) |
| [media.md](media.md) | Cloudinary for Valio product images | [ ] |
| [ux.md](ux.md) | Interaction model, screens, control room, design direction | [x] |

## DevOps for the lane phase
- **Lanes:** one worktree + branch each; `scripts/lane-setup` copies `.env` and `data/valio/`, runs `pnpm i`, sets the dev port. Project `.mcp.json` is shared; Verda and Aiven MCPs stay local to the lead (they can spend money).
- **Integration (every ~90 min, lead):** `pnpm check` + the `core/` purity lint rule + evals on fixtures + a Playwright screenshot + a clean-context diff review, then merge.
- **CI:** the same checks on every push (GitHub Actions, or CRACI runners).
- **Deploy:** one container (`adapter-node` + Dockerfile) to Aiven Runtime, fallback a Verda VM (D3). Tag `demo-good-N` at every working point.
