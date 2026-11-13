---
name: lane
description: How a lane agent works during the parallel build phase. Use when a session is started in a lane worktree, or told "your brief is docs/lanes/<x>.md", "work the <x> lane", or "you are the <x> lane".
---

# Working a lane

You are one of several agents building in parallel. Others work in sibling worktrees at the same time. Being fruitful together means staying in your lane, against the contracts.

1. **Orient (≤3 min).** Read `CLAUDE.md`, your brief `docs/lanes/<lane>.md`, and only the files its "Context to read first" lists. Run `git log --oneline -5 main` and `git status`. Confirm you're on `lane/<lane>` in its worktree.
2. **Edit only your owned paths.** If you need a change in `core/`, `ports/`, `package.json`, the layout or global CSS, write it under **Needs** in your brief and keep going against the fixture or a local shim. Don't wait. Need a dependency? Put it under Needs, unless the brief pre-approves it.
3. **Build in small steps.** One task → working → `pnpm check` → commit (terse, past tense). Prefer existing OSS (docs/BUILDING-BLOCKS.md) over writing it yourself. Use context7 for current library APIs.
4. **Use subagents** for independent sub-tasks (API research, tests, a self-review of your diff). Give each one a self-contained prompt and your owned paths. They report; you integrate.
5. **Stay current.** About every 90 min, or when the lead says `main` moved: `git fetch` → `git rebase main` → `pnpm check`. Resolve conflicts only in your own paths. If one lands in a shared file, stop and put it under Needs.
6. **Prove it.** Meet the brief's Acceptance checks for real: run the dev server on your port and take a Playwright screenshot to `scratch/`. Fixture mode must work.
7. **Report.** At the end of each run, or whenever you're blocked, append one line to the brief's **Report**: `time · done · stubbed · needs · ready to merge yes/no`. Commit the brief. Never push to `main`, never merge other lanes, never touch `.env`.
