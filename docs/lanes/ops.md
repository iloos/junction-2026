# Lane: ops (deploy, Operations, op stream, visitor sandboxes)

## Dispatch

- **Track:** G (SYNTHESIS §5/§8): sandboxes, Operations, deploy. Session 9c.
- **Branch / worktree:** `lane/g3` in `../junc26-lanes/ops`, base main `f2052ca`. Dev port 5176.
- **Owned paths:**
  - `src/lib/server/demo/**`, `src/lib/server/bus/**`, `src/lib/server/db/client.ts`
  - `src/routes/ops/**`, `src/routes/api/events/**`, `src/routes/api/demo/**`, `src/routes/healthz/**`
  - `Dockerfile`, `scripts/deploy/**`, `docs/foundations/deploy.md`
- **Next deliverable:** cleanup of the owned paths, then the plan upgrade once the store cache is on prod.
- **Depends on:** 8d's store cache (`lane/a-store-cache`) for the 10-visitor latency target.
- **Acceptance:** `pnpm gate` green; for anything touching sandboxes, `src/routes/ops/visitor-gate.e2e.ts` green on a production build.

## State

- **Prod:** main `f2052ca` on Aiven `mandate`. Smoke passes, including the commit race check on `ws-smoke`.
- **On main:**
  - One resolver for every surface (`demo/visitor.ts`): a signed cookie gives each browser its own sandbox `ws-j-<24 hex>`, seeded lazily with a fresh run. Rooms are `mine`, `ws-judges` and `ws-demo` (presenters only).
  - Judge keys `jk_<ws>.<exp>.<hmac>` (`demo/judge-key.ts`, `GET /api/demo/judge-key`).
  - A presenter session on /ops.
  - Per workspace: reset cooldown, kitchen queue, simulator overlay and served clock. The overlay and clock use an AsyncLocalStorage scope entered by `serveTool` and the kitchen queue.
  - A reset clears the workspace's idempotency rows.
  - /ops: urgency queue, wallboard, trace drawer with Stop, `?ws&run` deep links. Its held count matches the kitchen.
  - The op stream: paged catch-up, run re-anchoring, and a rebuild on a refused op.
- **On `lane/g3`, not merged:**
  - `c3c0017`: the judge-key tamper test always changes the MAC.
  - `7b8f752`: `SQL_TRACE`, `scripts/deploy/visitors.mjs`.
  - This brief and deploy.md.
- **Measured:**
  - 30 concurrent visitors on prod: 0 errors.
  - Planning is serialized on the 512 MB plan: 2.6 s alone, about 25 s each for 10 at once.
  - The store cache cuts one visitor's statements from 341 to 201.

## Open

- **Plan upgrade:** `startup-100-2048` ($0.0685/h, `aws-eu-central-1`) after the cache deploys. Lead approval pending. Then re-measure 10 concurrent visitors, target ≤ 5 s each.
- **F16 kitchen side:** the "link from an earlier run / another sandbox" notice and the sandbox reset label. The patch is with 1f (`scratch/f16-kitchen.patch`) to apply on `lane/c-kitchen`.
- **F16 request side:** /request review recovery after a reload, not started.
- Still hot after the cache: `store.kitchens` is read 16× per visitor, catalogue product docs 23× (8d's paths).
- `publishSim` has no callers, so live sandboxes show no simulator events.

## Traps

- **Aiven env updates replace the whole list.** Add single variables in the console; change the plan with `plan` alone.
- **No redeploy in the last 30 minutes before judging.**
- Prettier reformats on save, so scripted string replacements miss after a format; use the Edit tool.
- When resolving a rebase conflict, never take a whole file with `--theirs`/`--ours` in a file other lanes also edit. That reverted the request lane's work once.
- `Stop-Process` kills `node build` hard; old servers can keep a port and serve a deleted build. Check the port's listener before restarting.
- Per-process state (run pointers, sessions, cooldowns, rings, the state cache): never scale `mandate` past one instance.
- Other dev servers on the same `DATABASE_URL` hold Aiven connections (15 in total). Stop the ones you don't use.

## Resume

- **Worktree setup:** `pnpm i`; copy `.env` and `data/valio/` from the main checkout.
- **Checks:** `pnpm check && pnpm lint && pnpm test:unit --run`, then `pnpm gate` before handing a SHA.
- **Integration gate on a production build without Aiven:** `pnpm build`, run `scripts/deploy/serve-fixture.sh` (fixture DB, throwaway secrets, port 4177), then `GATE_URL=http://localhost:4177 npx playwright test -c scripts/deploy/pw-gate.config.ts`.
- **Load and statements against Aiven:** `SQL_TRACE=1 PORT=4178 node --env-file=.env build`, then `node scripts/deploy/visitors.mjs http://localhost:4178 5`.
- **Deploy:** see `docs/foundations/deploy.md` (redeploy, warm.sh, smoke with `SMOKE_KEY`).
