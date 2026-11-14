# Foundations

_One note per service: current API and versions, limits and cost, how it fits our port, the fixture fallback, gotchas. Read the note before touching that service. Lead-owned unless the note names an owner._

| Note | Covers |
|---|---|
| [valio-data.md](valio-data.md) (+ [valio-profile.json](valio-profile.json)) | Valio catalogue and mock API probe: cache, limits, units, hero products |
| [data.md](data.md) | Aiven Postgres + pgvector + LISTEN/NOTIFY, Drizzle, the PGlite fixture |
| [deploy.md](deploy.md) | Aiven Runtime service `mandate`: redeploy, smoke, warm-up, plan B (owner: G) |
| [gemini.md](gemini.md) | Gemini Decisions API (calibrated decisions), Flash-Lite structured output, SDK and key names |
| [models.md](models.md) | The LLM port and open models (Featherless Gemma); Nemotron parked by D7 |
| [mcp.md](mcp.md) | MCP server (SDK v2) inside SvelteKit, OpenAPI from zod, testing with the Inspector |
| [web.md](web.md) | Context.dev recall watch and Exa lookups: caching, spend caps, webhook (owner: D) |
| [ux.md](ux.md) | Interaction model, screens, control room, design direction |

Parked services (D7) are in [../archive/prep/foundations/](../archive/README.md): Modal, S-Pankki. Cloudinary was dropped (Valio data has no product images, D5).

## How a service change lands
- Spike code lives in `scratch/`, never in `src/`; findings go into the note.
- Every service sits behind a port with a fixture adapter; `pnpm gate` runs on fixtures only, with no network.
- There is no CI: the merge gate (`pnpm gate`) runs locally before the lead merges, and `scripts/deploy/smoke.sh` runs after each deploy.
