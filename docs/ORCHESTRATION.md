# Orchestration: concept first, then parallel lanes

How we work: **think hard, then build wide.** First a concept phase with one shared brain (brainstorm, research, concept, architecture). Then many agents in parallel lanes, mostly in auto mode, against frozen contracts. Overhead stays low because the coordination lives in a few files, not in chat.

## Mode 1: Concept (Fri 19:30 → ~Sat 00:30)
Goal: a concept good enough that a lane agent with no chat history can build its part correctly.

| Step | Output | Tooling |
|---|---|---|
| Diverge | Ideas in `ideas/IDEAS.md` | `superpowers:brainstorming`, the team |
| Research (parallel subagents, one question each) | `docs/research/<topic>.md`: sources, findings, and "what this means for us" in ≤1 page each | Research subagents; Exa/Context.dev/Cala probes |
| Pick | `D1` in DECISIONS | `idea-pick` skill (+ `judge`) |
| Concept | `docs/concept/CONCEPT.md`: problem, user, wow ladder, insight, scope in/out | Team plus the lead agent |
| Architecture | `docs/concept/ARCHITECTURE.md`: data model, ops, ports, routes, events, **lanes** | Lead agent; `Plan` subagent for review |
| Spikes (time-boxed, throwaway) | `scratch/spike-*` → findings into research/ | One agent each; 30–45 min |
| **Contracts commit** | `src/lib/core/types.ts`, `ops.ts`, `ports/*.ts`, fixtures, generator stub. Merged to `main` **before fan-out**. | Lead only |

The scaffold and empty deploy (STACK.md) run as a background agent during the concept phase. They don't wait for the idea.

## Mode 2: Lanes (from ~Sat 00:30)
A **lane** = one brief + one branch + one worktree + one agent session (+ its subagents).

```
docs/lanes/<lane>.md          brief (from _TEMPLATE.md): goal, owned paths, contracts used, acceptance, report
branch   lane/<lane>
worktree ../junc26-lanes/<lane>      (sibling folder, outside the repo)
dev port 5171, 5172, ...             (one per lane, in the brief)
```

Typical lanes (adjust in ARCHITECTURE.md): `data` (generator, fixtures, sponsor adapters), `viz` (main view, 3D spike), `agent` (LLM port adapters, tool loop, chat UI), `shell` (layout, routing, design system, polish), `mcp` (MCP server/App, stretch). **3–5 lanes at most.** More lanes cost more merges than they save.

### Rules that make parallel work fruitful
1. **Contracts before fan-out.** Lanes code against `core/` types and `ports/` interfaces plus fixtures that already exist on `main`. A lane never waits for another lane; it uses the fixture.
2. **Path ownership.** Each brief lists the paths that lane may edit. Shared files (`core/`, `ports/`, `package.json`, `app.css`, `+layout.svelte`) are lead-only. A lane that needs a change writes a request in its brief's **Needs** section and keeps going on the fixture.
3. **Small, frequent integration.** A lane commits small, then rebases on `main` at least every ~90 min. The lead merges ready lanes in order: data → agent → viz → shell.
4. **Acceptance = observable.** Each brief has a check that proves it's done (a command, a route, a Playwright screenshot). "Done" without that check isn't done (`superpowers:verification-before-completion`).
5. **Report in the brief, not in chat.** At the end of each run, the lane agent appends to its brief's **Report** section: what's done, what's stubbed, what's needed. The lead reads the reports, merges, and updates STATUS.md.
6. **Auto mode safe zone.** A project permission allowlist (see TOOLING.md; it's installed by a human, not by an agent) allows `pnpm`, `git` (no force-push), `npx`, `modal` and Playwright, and asks before `git push`. Lanes never push to `main`, and never touch `.env` or other lanes' worktrees.

### Sessions: one lead, peer sessions that think
- **Lead session** (orchestrator): owns the main checkout, contracts, merges, DECISIONS numbering and STATUS. Assigns chunks with owned paths and a "done when".
- **Peer sessions** (2 now): own worktrees and branches; may run their own subagents. They are **not passive executors**: each one keeps checking the whole shape (concept ↔ contracts ↔ evals ↔ demo ↔ scorecard), flags drift, contradictions and risks, and proposes improvements. Proposals arrive as a short message to the lead or as a branch with a sha; the lead decides and merges.
- Messages only for handoffs, blockers, real disagreements or improvements worth acting on; no status chatter. Findings go into repo docs (Report/Needs, research notes), not only chat.

### Overnight guardrails (round-2 review)
- One merger and one decision-number allocator (the lead). Peer sessions hand over a SHA + review; they never change the main checkout's branch.
- Each lane pins its base SHA, schema hash and seed hash, and its owned paths. Core-db owns persistence *implementations*, not the lead-owned contracts or migrations. Ops consumes store projections; jobs never own simulator truth.
- Missing contract → stop and write **Needs**; never invent a replacement.
- While the lead sleeps: no contract edits or merges; lanes checkpoint on the frozen base (no 90-min rebase); rebase after the lead wakes. Shared-contract changes need the lead's approval before lanes resume.
- Small commits; deterministic fixture checks; no network-dependent pass/fail; a browser screenshot for any UI claim.
- Start lanes with `pwsh scripts/lane-setup.ps1 <name>` (worktree + copies .env and data, own port).

### Starting a lane (lead)
```powershell
git worktree add ../junc26-lanes/viz -b lane/viz main
cd ../junc26-lanes/viz; pnpm i; Copy-Item ../../Junc26/.env .env   # copy, never symlink
claude   # first message: "Use the lane skill. Your brief is docs/lanes/viz.md."
```
Remove with `git worktree remove ../junc26-lanes/viz` (no `--force`) once merged.

### Inside a lane: subagents
The lane agent may fan out its *own* subagents for independent sub-tasks (`superpowers:subagent-driven-development` / `dispatching-parallel-agents`). Uses: research a library's API, write tests, review its diff. Subagents get a self-contained prompt and the brief path, and never edit outside the lane's owned paths.

### Integration (lead, every ~90 min, or when a lane reports ready)
Run the `integrate` skill: read the reports → merge ready lanes in order → `pnpm check` → deploy → update STATUS.md and PLAN.md → answer the **Needs** requests (contract changes go to `main` first, then lanes rebase).

### Heavier orchestration (opt-in)
The **Workflow** tool can script a fan-out (e.g. "5 agents each build one chart type, then a judge picks"). It's expensive. Use it only when a job is wide and well-specified, and say "use a workflow" explicitly.

## Late phase (Sat 22:00 →)
Lanes collapse back to **one integration branch**: `main` only, with the lead plus 1–2 polish agents and no new lanes. After the freeze (Sun 06:00), only the video, deck and submission.
