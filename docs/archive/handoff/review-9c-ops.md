# Review: 9c-ops (deploy, ops, bus, demo, sandbox)
_Checkpoint step 1 against main f2edb21, deployed on Aiven `mandate` (commit_sha f2edb21, smoke OK, ws-demo → run-mwfr9p7l, ws-judges → run-mwfr9pis). Nothing parked: lane/ops has no unmerged work._

## 1. Own scope
**Solid (evidence)**
- Deploy: Aiven Runtime from `main`, `/healthz` reports `tls:"verified"`; a wrong CA is rejected ("self-signed certificate in certificate chain", tested locally). Pool max 3 (`db/client.ts`). Env holds 14 vars by name; the key-replace gotcha is in deploy.md.
- Op stream: catch-up filters the run in SQL before the limit (`bus/catchup.test.ts`: 1,100 old ops + a fresh run); dedupe, ring and replay in `bus/bus.test.ts`; LISTEN/NOTIFY verified on prod (8 live traces during a 1.56 s agent run). With 1,116 old ops, /ops is live in 0.87 s.
- Ops UI at 10×/50× (dev `ws-stress`): queue at 50× has 2 long tasks (103 ms), 62 fps; wallboard at 50× 2 (143 ms). Measured, not asserted by a test.
- Reset keeps audit (old runs stay in `ops`; run-1's 15 ops survive). Sandbox reset only reaches ws-judges and holds a 20 s cooldown (`demo/sandbox.test.ts`). The presenter rule is in one place (`demo/presenter.ts`).
- Queue logic (`ops/cases.ts`) has 4 tests: order, deep link, evidence-only coverage, per-line deadline from the offer.

**Fragile / known bugs**
1. `/ops` scenario clock does not re-anchor on a reset made elsewhere: `stream.svelte.ts:99` clears state on `event: run`, but `anchor` (`+page.svelte:26`) only updates from this tab's own reset action. Until reload, the clock shows the old run's time.
2. `?/cancelAgent` with no form body throws a 500 (`+page.server.ts:99`, `request.formData()`), seen in prod logs from my own probe; it should be a 400.
3. Process-local state: `currentRun` (`demo/run.ts:19`), the sandbox cooldown (`sandbox.ts:11`), the agent-run lock and the sim ring are per process. Correct for one Runtime instance; wrong if anyone scales to 2.
4. The NOTIFY payload limit: events over 7,000 bytes are dropped with a warn (`bus/pg.ts:35`; ops fall back to a ref fetch). Trace digests are capped at 4 KB (`agent/loop.ts` `summarize`), so they fit today; a bigger `data` would vanish silently from the drawer.

**Untested paths**: `PgTransport` (`bus/pg.ts`) has no automated test, only the manual prod check; nor does the NOTIFY ref-fetch path or `publishSim` in Postgres (`allocateSeq`). The drawer's Stop on a running run was never seen mid-run (the scripted planner finishes in <1 s); cancellation is covered only by the agent lane's `agent/stop.test.ts`. `/api/events` reconnect → poll fallback was not exercised in a browser.

**Shortcuts**: names on /ops come from seeds + `SYNTH_PRODUCTS` (`ops/+page.server.ts`), not `catalog.get`; queue age uses first-held time per batch, not per op; `/api/events` is read-only by workspace allowlist, not by key.

## 2. Adjacent scopes
- **`publishSim` has zero callers.** Live workspaces never show simulator events; only `ws-synth` does. The ops brief's "simulator events labelled simulated" is true only in the synthetic tab. Core-db's overlay effects reach /ops only as `RecordAnomaly`.
- Store/auth edits I made in core-db and agent files (db-ports `followCurrentRun`, the lazy workspace ensure; auth `runId` from `currentRun`, the MCP_KEYS 4th field) are stable but cross-owned; 8d has the line list.
- The kitchen honours the queue deep link (`KitchenScreen.svelte:43`); the kitchen shows "Start over (sandbox)" in ws-judges (`:244`).
- Postgres double-commit race test exists but is opt-in (`store/pg-race.test.ts`, `MANDATE_TEST_PG=1`). I have not seen a run result for it; PITCH's "No double orders … concurrency test on Postgres" depends on it.

## 3. The whole product
- PITCH "115–120 The other side: same held lines in Operations [x]" holds: the queue shows held lines with owner, deadline and next step. Its "external agent tries a stale commit, server refuses" beat I did not verify on prod over MCP.
- The **do-not-claim** list (enforceable mandate until P0s) needs a fresh check by core-db: the hard ceiling landed after the €2.7M incident, but I didn't test it.
- **A judge breaks first:** (a) the shared sandbox, since judge1 and judge2 both write ws-judges and either can "Start over" the other's run mid-session (by design today); (b) a cold first hit (7.3 s first `/healthz` after a deploy; page ready 3.7 s cold vs 1.9 s warm); (c) Plan the event is still 4.24 s, 2.88 s of it the stage-2 rescues.
- Presenter flow on stage: with `DEMO_RESET_OPEN` unset, reset and run-agent need `curl` with the chef key (deploy.md has the command). No presenter UI exists.
- Open from reviews: round-4 triage #8 and #9 are done; nothing else in `docs/reviews/round4-triage.md` is mine.

## 4. Continuation (ranked)
1. **Per-judge sandboxes**: MCP_KEYS already takes `:workspace` (e.g. `judge1:external_agent:<k>:ws-judge1`); give key-less web visitors a per-session workspace or at least a per-session run. Removes the shared-sandbox collision. ~1 h.
2. **Presenter session** for /ops: enter the chef key once (httpOnly cookie, server-checked) to unlock Run / Stop / Reset on prod without `DEMO_RESET_OPEN`. ~1 h.
3. Fix bugs 1–2 above (clock re-anchor on `event: run`; 400 on an empty cancel). ~20 min.
4. A `PgTransport` integration test behind `MANDATE_TEST_PG=1` (publish → listen → deliver; >7 KB ref path), and run `pg-race.test.ts` once against Aiven, recording the result in deploy.md's evidence table.
5. Call `publishSim` from the simulator overlay (contention, cut-off) so live workspaces show labelled simulated events, or drop the claim.

**Disagreement**: the key-less sandbox reset is process-wide and visitor-triggered. For judging, I'd rather scope it to the visitor's own run (task 1) than keep a shared reset button.
