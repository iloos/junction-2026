---
name: integrate
description: The lead's integration pass during the parallel build: fan out lanes, merge ready ones, answer cross-lane needs, keep main deployable. Use when asked to "integrate", "merge the lanes", "start the lanes", "fan out", or roughly every 90 minutes in the build phase.
---

# Integrate (lead)

## Fan-out (once, after the contracts commit)
1. Check that `main` has `core/types.ts`, `core/ops.ts`, `ports/*.ts`, fixtures and the generator, and that `pnpm check` passes.
2. For each track in `docs/DISPATCH.md`, write `docs/lanes/<lane>.md` from `_TEMPLATE.md`: one-sentence goal, owned paths that **don't overlap**, the contracts used, observable acceptance checks, the dev port. Commit the briefs to `main`.
3. Create the worktrees: `git worktree add ../junc26-lanes/<lane> -b lane/<lane> main`, then `pnpm i` and copy `.env` (never symlink).
4. Give the human the exact opening line for each lane session: `Use the lane skill. Your brief is docs/lanes/<lane>.md.`

## Every ~90 min (or when a lane reports ready)
1. Read every brief's latest **Report** and **Needs** line (`git log` on each lane branch, plus the brief files).
2. **Needs first.** A contract change goes onto `main` as a small commit, and the affected lanes are told to rebase. Say no to scope creep.
3. **Merge ready lanes in order** (data → agent → viz → shell → mcp): `git merge --no-ff lane/<x>` → `pnpm check` → a quick Playwright smoke of the demo path. If it breaks, revert the merge and send it back via the brief.
4. Push `main` (ask first), confirm the deploy serves it, then tell the lanes to rebase.
5. Rewrite `docs/STATUS.md` and flip the PLAN markers. Run `vision-check` at the PLAN times.

## Late phase (Sat ~22:00)
Stop opening lanes. Merge what's ready, park the rest (`[!]` in PLAN with the reason), and remove merged worktrees (`git worktree remove`, no `--force`). From here: `main` only, plus polish.
