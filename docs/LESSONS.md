# Lessons from our previous builds

Sources: Junction25 (Heli), Buildarena (Sinch), veed back 2026, Sunstead26 (Aiven), Anchorus (ElevenLabs Warsaw), and day-job repos (interactive roadmap, logsight2, Eventapp, what-did-i-miss, another-repo, reasoner3). Evidence is in their git logs and docs.

## What went wrong, repeatedly
| Pattern | Where | Fix for this weekend |
|---|---|---|
| Strong pieces that were never wired end to end | Sunstead ("three strong, mostly-disconnected pillars"), Buildarena ("not wired") | Thin slice first, deployed by ~Fri 23:59 |
| Best code left unmerged on branches; merge churn | Sunstead, veed, Junction25 ("broken merge", "critical state" 03:44) | Commit to `main` hourly; branches live for less than 2h |
| Deploy plumbing (CORS, `/api` prefix, Docker) eating the first hours | veed | Single service (SvelteKit), deployed in hour 2 |
| SDK pivot mid-build | Buildarena (agent SDK → manual tool loop) | `LlmPort` from the start; manual loop or `ai` SDK, decided once |
| Debug logging added 45 min before the deadline | veed | Tracing from commit 1 |
| Pitch claims the code didn't back up | Sunstead vision-gaps review | `vision-check` skill every ~6h; PITCH claim → evidence table |
| Commits continuing after "finalcommit" | everyone | Freeze Sun 06:00; tag `demo-good`; record the backup video before polishing |
| Secret committed (`.env.local`) | Junction25 | `.gitignore` from minute 0 |
| Windows shell accidents (`nul`, `=3.0.0`, pasted-line files) | Anchorus, Helpottaa | Check `git status` before commits; `nul` is gitignored |
| Persistence bug lost data at finalize | Anchorus | Save on every op, not at the end; reload test in e2e |

## What worked
- **Docs split by tense** (Sunstead): OVERVIEW now / PLAN future / LOG past. Agents re-orient in seconds.
- **One plan with status markers** and old plans archived (Buildarena, veed).
- **A rubric file plus a pitch file** with a one-breath opener and demo beats (Sunstead `HACKINFO.md` / `PITCH.md`).
- **Seeded and generated data** everywhere: demos never depended on live APIs.
- **One prompt file per agent role** (veed `prompts/`), and topic packs with pitfalls and known-good examples (`context/`).
- **Short CLAUDE.md** (what-did-i-miss: 46 lines, commands plus hard rules) beats long ones (logsight2: 861 lines).
- **Ports with a no-LLM path** (reasoner3, what-did-i-miss): tests and demos run at $0 and never hang.
- **Typed, closed knowledge schema** (reasoner3 KB: closed node kinds and edge kinds, each with the reader that walks it). This is better than free-form GraphRAG soup, and is our pattern if the project has a knowledge graph.
