# Lessons from our previous builds

Sources: our earlier hackathon builds (Junction 2025, a Sinch hackathon, a video-generation hack, an Aiven challenge, the ElevenLabs Warsaw hack) and other projects of ours. Evidence came from their git logs and docs.

## What went wrong, repeatedly
| Pattern | Where | Fix for this weekend |
|---|---|---|
| Strong pieces that were never wired end to end | Aiven hack ("three strong, mostly-disconnected pillars"), Sinch hack ("not wired") | Empty scaffold deployed at 19:30; thin slice live by Sat 06:00 |
| Best code left unmerged on branches; merge churn | three of five builds ("broken merge", "critical state" at 03:44) | Commit to `main` hourly; branches live for less than 2h |
| Deploy plumbing (CORS, `/api` prefix, Docker) eating the first hours | video hack | Single service (SvelteKit on Vercel), deployed in hour 1 |
| SDK pivot mid-build | Sinch hack (agent SDK → manual tool loop) | `LlmPort` from the start; manual loop or `ai` SDK, decided once |
| Debug logging added 45 min before the deadline | video hack | Tracing from commit 1 |
| Pitch claims the code didn't back up | Aiven hack vision-gaps review | `vision-check` skill every ~6h; PITCH claim → evidence table |
| Commits continuing after "finalcommit" | everyone | Freeze Sun 06:00; tag `demo-good`; record the backup video before polishing |
| Secret committed (`.env.local`) | Junction 2025 | `.gitignore` from minute 0 |
| Windows shell accidents (`nul`, `=3.0.0`, pasted-line files) | two builds | Check `git status` before commits; `nul` is gitignored |
| Persistence bug lost data at finalize | ElevenLabs hack | Save on every op, not at the end; reload test in e2e |

## What worked
- **Docs split by tense**: "now" / "future" / "past". Agents re-orient in seconds. (Here: STATUS / PLAN / git log + DECISIONS.)
- **One plan with status markers**, with old plans archived.
- **A rubric file plus a pitch file** with a one-breath opener and demo beats.
- **Seeded and generated data** everywhere: demos never depended on live APIs.
- **One prompt file per agent role**, and topic packs with pitfalls and known-good examples.
- **A short CLAUDE.md** (~50 lines: commands plus hard rules) beats long ones (we've had an 861-line one).
- **Ports with a no-LLM path**: tests and demos run at $0 and never hang.
- **A typed, closed knowledge schema** (closed node kinds and edge kinds, each with the reader that walks it) beats free-form GraphRAG soup. Use it if the project has a knowledge graph.
