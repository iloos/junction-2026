# Junction 2026: team repo

**Is:** our Junction 2026 hackathon build (Espoo, 13–15 Nov 2026). Challenge: **Valio Aimo "Trusted Trade Agents"** (D1), plus stacked challenges. Product: **Mandate**, a kitchen purchasing agent with an enforceable mandate; see [docs/concept/CONCEPT.md](docs/concept/CONCEPT.md) and [docs/STATUS.md](docs/STATUS.md).
**Stack:** SvelteKit 2.70 + Svelte 5 runes + Vite 8, Tailwind 4, bits-ui, d3 (maybe one three.js view), LLM behind one port (Gemini decisions, Gemma/Nemotron via OpenAI-compatible). Data in **Postgres** (Aiven; PGlite as the fixture) via Drizzle behind a store port (D3). See [docs/STACK.md](docs/STACK.md).
**Deploy:** one container (`adapter-node@^5` + Dockerfile) on Aiven Runtime, fallback a Verda VM (D3). **Not Vercel.**
**Team:** solo lead plus parallel agent lanes. The lead session owns the main checkout; other sessions never switch branches there (D4).
**Commit:** terse, past-tense subject ≤72 chars; body only when it carries the why.

## Event rules (break one and we're disqualified)
- **No project code before Fri 13 Nov 19:30.** Docs, plans and tool config are prep. No `.ts`/`.svelte` file, not even a stub, before then. Do not copy files from any other repo on this machine; open-source libraries are fine.
- The project must stand alone: not related to any existing company, no employer code, no private data.
- Everything is MIT-licensed and public at submission. No secrets in git.
- Final submission **Sun 15 Nov 10:00**, hard. Our feature freeze: **Sun 06:00**.

## Hard rules
1. **Thin slice first.** One end-to-end path (data in → transform → view → agent acts on it) working and deployed before anything goes deep.
2. **Pure core, ports at the edge.** `src/lib/core/` is plain TS: no Svelte, no DOM, no vendor SDK. LLM, storage, search and sponsor APIs are ports with a real adapter and a **fixture** adapter. Every flow has a fixture path, so the demo survives a dead API or Wi-Fi.
3. **If the agent changes state, it goes through one function** (`applyOps`), and the UI shows the change happening.
4. **Data at scale:** datasets are `$state.raw` and reassigned, never mutated in place. Pass ids, not objects, to chart/graph libs. Build indexes lazily. Charts get explicit heights. Test at 10× demo size.
5. **Secrets stay server-side** in `src/lib/server/`, read from `.env` (gitignored). `.env.example` holds names only.
6. **Spend caps:** `LLM_PROVIDER=fixture` by default in dev. The app uses `claude-sonnet-5-5` (or an open model via Featherless/Verda); Opus only by explicit choice. Every call sets `max_tokens`; agent loops cap at 8 steps. Every provider console has a spend limit.
7. **Traced or it didn't happen.** Every LLM call logs model, tokens, latency and tool calls (dev console plus the trace drawer).
8. **Done means seen.** Verify UI changes with a Playwright screenshot or in the browser before saying they're done. Don't claim in PITCH.md what isn't wired.
9. **Dependencies:** prefer an existing OSS library to writing it ([docs/BUILDING-BLOCKS.md](docs/BUILDING-BLOCKS.md)). Any new dependency over ~500 kB is cleared with the lead first.
10. **Parallel lanes** ([docs/ORCHESTRATION.md](docs/ORCHESTRATION.md)): concept and contracts first, then one brief + branch + worktree per lane (`docs/lanes/<lane>.md`). Edit only your owned paths; shared files are lead-only (use the brief's **Needs**). `pnpm i` inside the worktree (never symlink `node_modules`); own dev port. Only the lead merges to `main`. Rebase on `main` about every 90 min. Lane agents use the `lane` skill; the lead uses `integrate`.
11. **No artifacts at repo root.** Scratch goes to `scratch/` (gitignored). On Windows, check `git status` for stray `nul` / pasted-line files.

## Docs (keep each short)
| File | Who edits | What |
|---|---|---|
| [docs/STATUS.md](docs/STATUS.md) | lead | Now: what works, next 3 steps, traps. Rewritten each checkpoint. |
| [docs/PLAN.md](docs/PLAN.md) | everyone, own lines only | The one plan: phases, roles, shifts, `[x] [~] [ ] [!]` markers |
| [docs/DECISIONS.md](docs/DECISIONS.md) | anyone | `D#` · choice · why · what would reopen it. Append only. |
| [docs/concept/](docs/concept/CONCEPT.md) | lead + team | CONCEPT (product), PRODUCT (personas, stories, flows, edge cases), SCORECARD (criteria → evidence) and ARCHITECTURE (contracts, lanes). Frozen at fan-out; changed only via the lead. |
| [docs/foundations/](docs/foundations/README.md) | lead | Per-service notes (gemini, models, modal, data, mcp, ux, valio-data). Read before touching that service. |
| docs/review/ | outside reviewers | Adversarial reviews and the prompt that produced them |
| docs/lanes/<lane>.md | that lane | Brief, Needs, Report |
| docs/research/<topic>.md | research agents | ≤1 page: sources, findings, "means for us" |
| [docs/PITCH.md](docs/PITCH.md) | pitch owner | Opener, demo beats, claim → evidence |

`git log` is the history log. Reference (look up, don't preload): [docs/event/](docs/event/EVENT.md), [docs/strategy/WINNING.md](docs/strategy/WINNING.md), [docs/STACK.md](docs/STACK.md), [docs/BUILDING-BLOCKS.md](docs/BUILDING-BLOCKS.md), [docs/LESSONS.md](docs/LESSONS.md), [docs/TOOLING.md](docs/TOOLING.md), [docs/ideas/](docs/ideas/IDEAS.md).

## Commands
`pnpm dev` · `pnpm check` (svelte-check) · `pnpm lint` (prettier + eslint) · `pnpm test:unit` (vitest) · `pnpm test:e2e` (Playwright) · `pnpm build` then `node build`. Valio probe (cache-through): `python -I scripts/probe/valio_probe.py` with `VALIO_API_KEY` exported; cache in `data/valio/cache/` (gitignored, copy into lane worktrees with `.env` and `data/valio/`).

## Comments
Say what is true now and why, never how the code got there.
