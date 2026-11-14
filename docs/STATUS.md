# STATUS

_The lead rewrites this at each checkpoint. It is the "now": what works, what's next, what bites._

**Updated:** Sat 14 Nov late, end of ring 5 (lead junc26-fd). **All lanes closed for a restart.** Next ring starts from [handoff/ring6/RESTART.md](handoff/ring6/RESTART.md) (sessions, foundations first, queued work, final SHAs). The ring 5 picture and Round 12 routing: [handoff/ring5/SYNTHESIS.md](handoff/ring5/SYNTHESIS.md). Every user steer with owner and state: [handoff/ring4/USER-DIRECTIVES.md](handoff/ring4/USER-DIRECTIVES.md). Latest adversarial review: [review/ROUND12-ADVERSARIAL.md](review/ROUND12-ADVERSARIAL.md). Decisions through D21: [DECISIONS.md](DECISIONS.md).

**Deployed:** https://app.mandate.kitchen (Aiven Runtime `mandate`, Postgres `pg-1dfeeeed`, project `junction26jq`); landing https://mandate.kitchen (Cloudflare Worker, `site/`, served `dfff213`). Prod runs `a9f06ee` (smoke: 13 pass, 13 skipped without SMOKE_KEY, 1 fail: dock-sync "You approved N lines"). Migrations through 0005 (traces) applied. Main is ahead of prod; see RESTART for the last landed SHA and what still needs a deploy. Redeploy: merge to main, gate GREEN, push, the Ops session deploys and runs `scripts/deploy/warm.sh` + `smoke.sh` (procedure in [lanes/ops.md](lanes/ops.md)).

**Works end to end (prod or main, gate green):**
- **Kitchen:** seven joinable seeded kitchens, each with its own event, profile, rules and labelled simulated history; plan → decisions in the right rail (Decide on top, lines highlighted) → approve (page or dock, D13) → order → receipt; retries keep one receipt; System → "Start over" resets only this sandbox; diet and allergen marks; product cards with barcode-verified Valio Aimo photos (Kitchen rows, bills, chips; Request).
- **Request:** editable steps, delivery-date control, dish path (ready-made vs raw, meat-ratio reasoning), over-limit options, remembered choices; the ask is a first-class need (D18); diet asks become requirements (R12-03); unknown units ask (R12-01).
- **Core:** one requirement vocabulary and `meets()` (D16); every line bound to its need's ask at quote and commit (D18, R12-01); one `commandKey`; cancellation fence inside the commit transaction.
- **Chat:** follows the page's plan, narrates work, a yes acts on the offered action only (D21), no raw ids.
- **Agent door:** MCP/REST with judge keys, absolute links, pairing, named refusals, `revise_menu` (R12-08).
- **Ops:** Orders, Demand per day, refusal causes; live via `/api/events` within one browser's sandbox (an order shows in another tab in 0.6 s).
- **Observability:** persisted traces (Postgres, 7 days) with request ids, JSON logs. No OpenSearch (Aiven refuses Runtime log shipping on our project).

**Known open (top):** R12-02 cereal codes in `meets()`, R12-04 contention adds the full need (8d's Next); Ops doesn't follow a reset in another tab; dock approval status missing on prod; Ops rework not started; UI foundations (RESTART "Foundations first").

**Waiting on the user:** PUBLIC_ORIGIN in the Aiven console on `mandate` · the Nemotron deployment name (current 404) · SMOKE_KEY · history rewrite and placeholder Valio prices before going public (also fixes the public Source 404) · OK for 91 and da to push their branches · the Ops brainstorm with the site session · whether to review the three foundation docs before fan-out.

**Rules learned (keep):**
- The main checkout is lead-only; lanes work in `../junc26-lanes/<lane>`; stage exact paths; push only after `merge-gate: GREEN`.
- Lanes run `pnpm gate --only check,lint` plus targeted tests; the lead's main gate is the only full gate (one machine lock). Kill a stopped gate by PID.
- Dev servers and test previews with `DATABASE_URL=` blank (worktree `.env` points at prod).
- Bundle data files with static imports; `src/` is not shipped in the image (the listings ENOENT on prod).
- Aiven env updates via the API replace the whole list: env and secrets only through the console.
- Peer sessions are addressed by name: ab = 1f (kitchen), e6 = 8d (core), 9e = 9c (ops/deploy), 2f = 91 (evals), plus c3, d0, da, 41, 73, 0d; B, E were lead subagents.
- A peer's permission-blocked action is never relayed (no laundering); pushes of a lane's branch need the user's own OK.
