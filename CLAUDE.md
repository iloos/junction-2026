# Junction 2026 — team repo

**Is:** our Junction 2026 hackathon build (Espoo, 13–15 Nov 2026). Challenge: _TBD, see [docs/event/CHALLENGE.md](docs/event/CHALLENGE.md)_.
**Stack:** SvelteKit 2 + Svelte 5 runes + Vite 8, Tailwind 4, bits-ui, d3 (and maybe one three.js view), Claude/Gemini behind one LLM port. Persistence = localStorage/IndexedDB behind a storage port. See [docs/STACK.md](docs/STACK.md).
**Deploy:** _TBD in hour 2_ (single service: SvelteKit adapter-node, or adapter-static + one API host).
**Commit:** terse, past-tense subject ≤72 chars, body only when it carries the why. Commit + push to `main` often; short-lived branches only.

## Event rules that bind code (read once, never break)
- **No code written before the event** (hacking starts Fri 13 Nov 19:30). Docs, plans and tooling config are prep; app code is not. Do not copy code from other repos on this machine (another company, reasoner3, another-repo, roadmap...). Re-deriving a *pattern* is fine; pasting a file is not.
- Nothing "related to an already existing company" — the project must stand alone. Ideas that overlap with another company are framed generically and built from scratch.
- Everything submitted is MIT-licensed and public. No secrets, no proprietary data in git.
- Final submission **Sun 15 Nov 10:00** (hard). 2-min video, pitch deck PDF, demo + source link. Feature freeze Sun 06:00.

## Hard rules
1. **Thin slice first.** One end-to-end path (data in → transform → dashboard → agent answers about it) working and deployed before any part goes deep. Integration beats parallel pillars.
2. **Pure core, ports at the edge.** `src/lib/core/` is plain TS: no Svelte, no DOM, no vendor SDKs. LLM, storage, search (Exa/context.dev/Cala...) are ports in `src/lib/ports/` with a real adapter and a fake/fixture adapter. Every pipeline has a no-LLM / fixture path so the demo survives a dead API.
3. **One door for writes.** State changes go through `applyOps(state, ops)` (or the equivalent). Agent tool calls *propose* ops; the UI applies them visibly.
4. **Data at scale:** loaded datasets are `$state.raw` and reassigned, never mutated. Pass ids, not objects, into chart/graph libs. Build indexes lazily. Charts get explicit heights. Stress-test with the generator at 10× the demo size.
5. **Secrets server-side only.** Keys live in `.env` (gitignored) and are read in `src/lib/server/`. Never in client code, never committed. `.env.example` lists names only.
6. **If it isn't traced, it didn't happen.** Every LLM call logs model, tokens, latency, and tool calls to the dev console / a trace panel. No debug-logging sprints in the last hour.
7. **Don't claim what isn't wired.** PITCH.md claims must each point at a working thing; run the `vision-check` skill every ~6h.
8. **No artifacts at repo root.** Scratch output goes to `scratch/` (gitignored). On Windows watch for stray `nul` / pasted-shell-line files.

## Docs (split by tense — keep each short)
| File | Tense | Rule |
|---|---|---|
| [docs/OVERVIEW.md](docs/OVERVIEW.md) | now | Rewritten to match reality. What exists and works. |
| [docs/PLAN.md](docs/PLAN.md) | future | The only plan. `[x] [~] [ ] [!]` markers. Old plans move to `docs/archive/`. |
| [docs/LOG.md](docs/LOG.md) | past | Append-only, timestamped, one line per meaningful step. |
| [docs/DECISIONS.md](docs/DECISIONS.md) | past | `D#` · choice · why · what would reopen it. |
| [docs/handoff.md](docs/handoff.md) | now | Rewritten at the end of every session/shift: state, next 3 steps, traps. |
| [docs/PITCH.md](docs/PITCH.md) | future | One-breath opener, demo beats, claim → evidence. |

Reference (look up, don't preload): [docs/event/](docs/event/) (rules, schedule, sponsors, challenge), [docs/strategy/WINNING.md](docs/strategy/WINNING.md), [docs/LESSONS.md](docs/LESSONS.md), [docs/STACK.md](docs/STACK.md), [docs/BUILDING-BLOCKS.md](docs/BUILDING-BLOCKS.md) (OSS to reuse; prefer an existing library over writing it), [docs/TOOLING.md](docs/TOOLING.md), [docs/ideas/IDEAS.md](docs/ideas/IDEAS.md).

## Commands
_Fill in at scaffold time (Fri 19:30+)._ Expected: `pnpm dev`, `pnpm check` (svelte-check + tsc + lint + unit), `pnpm test:e2e`, `pnpm gen:data -- --n 100000`.

## Comments
Say what is true now and why, never how the code got there.
