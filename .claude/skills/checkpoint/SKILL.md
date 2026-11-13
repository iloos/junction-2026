---
name: checkpoint
description: A short ritual at the end of a slice or shift that keeps the repo safe and the status true. Use after finishing a slice, before a break or sleep, before switching tasks, or when asked to "checkpoint", "wrap up", or "hand off".
---

# Checkpoint (keep it under 3 minutes)

1. Gate: `pnpm check`. If it fails, fix it, or say why in the commit body.
2. Run `git status`. Remove stray files (`nul`, pasted shell lines, root-level artifacts → `scratch/`). Make sure no `.env` or keys are staged.
3. Commit with a terse past-tense subject. Workers merge their short branch via the lead; the lead pushes `main`.
4. Flip your own markers in `docs/PLAN.md`. Add a `D#` to `docs/DECISIONS.md` only if a real choice was made.
5. **Lead only:** rewrite `docs/STATUS.md` (works end to end · deployed URL · next 3 · traps) and confirm the deployed URL serves `main`.
