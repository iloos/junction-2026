---
name: checkpoint
description: End-of-slice or end-of-shift ritual that keeps the repo and docs true and safe to hand to another agent or teammate. Use after finishing a slice, before a break or sleep, before switching tasks, or when asked to "checkpoint", "wrap up", or "hand off".
---

# Checkpoint

1. Run the gate: `pnpm check` (and `pnpm test:e2e` if the demo path changed). If it fails, fix it or record why in the handoff.
2. Run `git status`. Remove stray files (`nul`, pasted shell lines, root-level artifacts → `scratch/`). Make sure no `.env` or keys are staged.
3. Commit with a terse past-tense subject; push to `main` (or merge the short branch).
4. Update the docs by tense:
   - `docs/OVERVIEW.md`: rewrite "Works end to end" to match reality.
   - `docs/PLAN.md`: flip the markers.
   - `docs/LOG.md`: append one line.
   - `docs/DECISIONS.md`: add a `D#` if a choice was made.
   - `docs/handoff.md`: rewrite with where we are, the next 3 steps, and the traps.
5. If it's past Sat 12:00: confirm the deployed URL serves this commit.
