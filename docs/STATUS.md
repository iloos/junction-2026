# STATUS

_The lead rewrites this at each checkpoint. It is the "now": what works, what's next, what bites._

**Updated:** Sun 15 Nov 01:00, ring 6 (lead junc26-52). Five lanes S1–S5 plus a user-run canvas lane S6: [handoff/ring6/SESSIONS.md](handoff/ring6/SESSIONS.md). Freeze 06:00, submission 10:00.

**Deployed:** https://app.mandate.kitchen runs wave F `ed20a82` (smoke: race OK, UI 13/14; the one fail is a stale room test, S5 fixing); wave G `4de483a` deploying; wave H gating. Every wave: full gate → push → S4 deploys (the user's standing OK) → the lead smokes with SMOKE_KEY from the main checkout → S5 playtests.

**Works on prod (ring 6):**
- **Hero journey** (moment 2): "a no-meat dinner for 120 with a peach dessert" → menu → plan (20 lines, all priced or labelled) → every held line in a decision → approve → ordered → on Ops. Passed 10/10 on 4ad27c0 with one workaround (dock open hides Review; S2+S3 fixing).
- **Own kitchens and the room** (D24–D26): "Your own kitchen" first on the picker, sample kitchens below; your kitchen persists across tabs and reloads; the room's "Join as your own store", full-screen QR, live orders and first-order light-up on Ops; a store-owner gate that fails closed.
- **Shortage cascade** (moment 1): one shortage re-plans every kitchen inside its own rules; Ops Room shows the per-store outcome.
- **Valio's view** (moment 4): Ops Forecast from the D27 stock model (seeded, labelled simulated, every estimate sourced).
- **Kitchen:** "your week, handled" ledger, per-line Accept · Reject · Swap with one "Accept all", the D28 compare panel, photos with a labelled fallback ladder (exact → pack may differ → brand → category).
- **Trust fixes:** the chat can't execute a model rewrite of the order (F1); diet and brand survive every door (F2); one ranking for chat and /request (D23); vegan milk never becomes sorbet; gluten cereal codes.

**Known open:** the dock-open approve path (hero), photo fallbacks on rows (wave H), OM-3/OM-4 (kitchen and preset per tab, S1), D28 steer chips beyond Cheaper/Finnish/In stock (S1), the public-clone fixture (S5, 06:00–09:00), the submission texts and video plan (S5).

**Decisions tonight:** D23 one conversation two views · D24 room mode · D25 your own kitchen first · D26 the workspace persists · D27 stock model (+ the Valio twin and incident deck, held) · D28 steerable alternatives, the chef has the last word. Reviews: [independent repo review](review/INDEPENDENT-REPO-2026-11-14.md), [one-of-many audit](review/ONE-OF-MANY-2026-11-15.md). Valio's API is a static snapshot (valio-data.md re-probe).

**Waiting on the user:** D22 (OAuth approve from an outside client) · Verda/Featherless · rotate judge keys and SMOKE_KEY before public · history rewrite and placeholder prices before public.

**Rules learned (keep):**
- The main checkout is lead-only; lanes work in `../junc26-lanes/<lane>`; stage exact paths; push only after `merge-gate: GREEN`.
- Lanes run `pnpm gate --only check,lint` plus targeted tests; the lead's main gate is the only full gate (one machine lock). Kill a stopped gate by PID.
- Dev servers and test previews with `DATABASE_URL=` blank (worktree `.env` points at prod).
- Bundle data files with static imports; `src/` is not shipped in the image (the listings ENOENT on prod).
- Aiven env updates via the API replace the whole list: env and secrets only through the console.
- Peer sessions are addressed by name: ab = 1f (kitchen), e6 = 8d (core), 9e = 9c (ops/deploy), 2f = 91 (evals), plus c3, d0, da, 41, 73, 0d; B, E were lead subagents.
- A peer's permission-blocked action is never relayed (no laundering); pushes of a lane's branch need the user's own OK.
