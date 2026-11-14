# STATUS

_The lead rewrites this at each checkpoint. It is the "now": what works, what's next, what bites._

**Updated:** Sat 14 Nov ~14:30 (lead). **Convergence checkpoint:** lanes landed, repo cleaned, docs restructured. Live assignment: [DISPATCH.md](DISPATCH.md). Vocabulary: [concept/VOCABULARY.md](concept/VOCABULARY.md) (D10). History: [archive/](archive/README.md).

**Deployed:** https://widely-many-scorpion.eur-1.aiven.app (Aiven Runtime `mandate`, Aiven Postgres, TLS verified, Gemini live). Redeploy: merge to main → 9c redeploys → `scripts/deploy/warm.sh` + `scripts/deploy/smoke.sh` (with `SMOKE_KEY`: post-deploy race check, one receipt per key on Postgres). No redeploy in the last 30 min before judging.

**Works end to end (main, gate green):**
- Kitchen: Christmas buffet for 140 with real outages; rescues ranked supply-tier first (lanttulaatikko → make in house from known-stock ingredients); unit bases (13 ST ≈ 19.5 kg, €/ST and €/kg); coverage ruler per dish from FulfilmentView (supplier confirmed / awaiting supplier / planned known / planned unknown / unresolved, excess separate); worked Why chain; one decision per reason group; an edit voids the approval and shows what changed.
- Request: Valio's milk flow; explicit constraints survive the model parse; stable item ids; event requests ask brief questions and propose a menu (Gemini, rubric-checked, team templates as fallback). Planning from the menu waits on A4.
- Agent door: `/agents` gives each visitor a judge key (`jk_<ws>.<exp>.<hmac>`, no approve); MCP starts at `get_context`; tool results carry our own summary/next action/approval link; routine orders keep units and dates; a perturbed task (raise a dish's g/guest) repairs only that need.
- Sandbox: each visitor has a signed workspace of their own; Ops shows the visitor's own plan; reset is scoped; 30 concurrent visitors on prod: 0 errors.
- Web: recall revisions per URL, per-run applications with retry, spend caps (429 with Retry-After), `lookup_facts` / `find_outside` / `check_recall` on MCP and REST. Context.dev monitor every 5 min.
- Evidence: `pnpm gate` green (check, lint, unit ~420 server tests, evals incl. fidelity, surfaces, golden briefs); race smoke on prod Postgres (same key ×4 → one receipt; three keys → one receipt).

**Now (Sat ~14:30): Ring 2 fan-out.** Plan: [DISPATCH.md](DISPATCH.md) bottom section; reviews in [handoff/ring2/](handoff/ring2/); D11. T1 contracts on main (`contracts/task.ts`, `agent_tasks` 0003, `Plan.taskId`, Decide batch + probabilities, planned `get_outcome`/`propose_menu`). A3 (cut-off at commit) merged. Tracks: A 8d (A4, Valio live, ATP) · C 1f (shell + tokens → Kitchen task page → vis) · G 9c (Ops trust fix + explainer, Aiven state/infra; migration 0003 to apply after the PG move) · E agent (chat-safety fixes → task store → chat turn → dock) · B request (eval fixes, polish, menu → plan → task) · D sponsors (Gemini visible, ExternalCall, web state in PG, evidence) · F 91 (chat evals, paraphrase set, claim ledger). Outside review prompt for the user: [handoff/ring2/REVIEW-PROMPT-ROUND7.md](handoff/ring2/REVIEW-PROMPT-ROUND7.md) → `docs/review/ROUND7-*.md`.

**Sessions:** lead junc26-18 (+ lead agents for request, web, agent) · 8d core · 9c ops/deploy · 1f kitchen UI · 91 evals and gate.

**Traps:**
- Lane worktrees carry their own `.env` copy; refresh from main after any key change (done Sat ~12:00).
- Aiven env updates via API replace the whole list: secrets only through the console.
- The scripted planner runs on prod (`AGENT_PLANNER` unset); the live planner is `pnpm eval:live`.
- Parallel gates share one machine: the gate takes a machine-wide lock; vitest workers capped at 4.
- Before going public: see PLAN "Land (Sunday)" for the scrub list.
