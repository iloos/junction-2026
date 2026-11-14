# STATUS

_The lead rewrites this at each checkpoint. It is the "now": what works, what's next, what bites._

**Updated:** Sat 14 Nov, Ring 4 (lead). **Convergence checkpoint:** lanes landed, repo cleaned, docs restructured. Live assignment: [DISPATCH.md](DISPATCH.md) (Ring 3). Vocabulary: [concept/VOCABULARY.md](concept/VOCABULARY.md) (D10). History: [archive/](archive/README.md).

**Deployed:** https://app.mandate.kitchen, landing https://mandate.kitchen (Cloudflare Worker, `site/`); fallback https://widely-many-scorpion.eur-1.aiven.app (Aiven Runtime `mandate` startup-100-2048, Postgres startup-4 on AWS Frankfurt with PgBouncer, TLS verified, Gemini live). Prod runs `70c30e2`; migrations through 0004 applied; rollback branch `rollback` = `f3591fd`. 10 concurrent visitors planning the event: p50 3.6 s (p95 4.0), alone 0.6 s, 0 errors. Staging: `mandate-staging` https://ideally-expert-wolf.eur-1.aiven.app builds the `staging` branch (fixture model, shared DB). ~$0.24/h. Redeploy: merge to main → 9c redeploys → `scripts/deploy/warm.sh` + `scripts/deploy/smoke.sh` (with `SMOKE_KEY`: post-deploy race check, one receipt per key on Postgres). No redeploy in the last 30 min before judging.

**Works end to end (main, gate green):**
- Kitchen: Christmas buffet for 140 with real outages; rescues ranked supply-tier first (lanttulaatikko → make in house from known-stock ingredients); unit bases (13 ST ≈ 19.5 kg, €/ST and €/kg); coverage ruler per dish from FulfilmentView (supplier confirmed / awaiting supplier / planned known / planned unknown / unresolved, excess separate); worked Why chain; one decision per reason group; an edit voids the approval and shows what changed.
- Request: Valio's milk flow; explicit constraints survive the model parse; stable item ids; event requests ask brief questions and propose a menu (Gemini, rubric-checked, team templates as fallback). Planning from the menu waits on A4.
- Agent door: `/agents` gives each visitor a judge key (`jk_<ws>.<exp>.<hmac>`, no approve); MCP starts at `get_context`; tool results carry our own summary/next action/approval link; routine orders keep units and dates; a perturbed task (raise a dish's g/guest) repairs only that need.
- Sandbox: each visitor has a signed workspace of their own; Ops shows the visitor's own plan; reset is scoped; 30 concurrent visitors on prod: 0 errors.
- Web: recall revisions per URL, per-run applications with retry, spend caps (429 with Retry-After), `lookup_facts` / `find_outside` / `check_recall` on MCP and REST. Context.dev monitor every 5 min.
- Evidence: `pnpm gate` green (check, lint, unit ~420 server tests, evals incl. fidelity, surfaces, golden briefs); race smoke on prod Postgres (same key ×4 → one receipt; three keys → one receipt).

**Now (Sat evening): Ring 4 checkpoint, landing.** Plan: [handoff/ring4/SYNTHESIS.md](handoff/ring4/SYNTHESIS.md) (reviews alongside); Ring 3 context in [handoff/ring3/](handoff/ring3/). Prod `6af9c1b` at https://app.mandate.kitchen (fallback the aiven.app URL); public site https://mandate.kitchen. Guarantees hold (adversarial suite: 2 open, D's web durability). Valio's answers are applied (≥999999 = unknown, lot 1, 429 pause; D6 amendment, D8a). Next: M1 dock plan pin (1f), the Ops Orders tab (9c), substitute kinds + one dueOf (8d), web routes through the gate (D), the docs truth pass and CLAIMS rows, then the video on the freeze build.

**Sessions:** lead junc26-18 (+ lead agents for request, web, agent) · 8d core · 9c ops/deploy · 1f kitchen UI · 91 evals and gate.

**Traps:**
- Lane worktrees carry their own `.env` copy; refresh from main after any key change (done Sat ~12:00).
- Aiven env updates via API replace the whole list: secrets only through the console.
- The scripted planner runs on prod (`AGENT_PLANNER` unset); the live planner is `pnpm eval:live`.
- Parallel gates share one machine: the gate takes a machine-wide lock; vitest workers capped at 4.
- Before going public: see PLAN "Land (Sunday)" for the scrub list.
