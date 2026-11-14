# STATUS

_The lead rewrites this at each checkpoint. It is the "now": what works, what's next, what bites._

**Updated:** Sat 14 Nov ~08:45 (lead session). **Tag `ring0`** = main 4b030a4 (code identical to deployed f2edb21).
**State:** Ring 0 stable and deployed. Checkpoint done: 8 internal reviews + 5 outside (round 5) → [handoff/SYNTHESIS.md](handoff/SYNTHESIS.md) (32 ranked findings F1–F32, rulings, tracks T0/A–G, owners' replies in §7). Handoffs in `docs/lanes/{core-db,ops,baseline,kitchen,request,agent2,web}.md`. 252 server tests, `pnpm eval` 5/5, `pnpm eval:agent` 9/9, `pnpm test:pg` 4/4 on Aiven (opt-in), `pnpm test:live` 3/3 (Gemini, opt-in).
**Deployed:** https://widely-many-scorpion.eur-1.aiven.app (Aiven Runtime `mandate`, Postgres, TLS verified, `LLM_PROVIDER=gemini`, web keys set). Warm up before judging (deploy.md). Redeploy: push main → `aiven_application_redeploy` → `scripts/deploy/smoke.sh`.
**Works end to end on prod:** Christmas plan with real outages, curated rescues, edit-after-rescue voids and re-binds approval, commit, same receipt on retry; `/request` Valio milk flow (Gemini parse) with case questions and a size check; hard ceiling; MCP judge key can't approve; Ops urgency queue + wallboard + agent traces; recall drill; sandbox self-reset.
**Biggest open (SYNTHESIS P0s):** F1 shared sandbox · F2 Ops on another workspace · F3 parse can drop "lactose-free" · F4 agent units/dates · F5 rescue with unknown supply · F6 no agent door · F7 open event requests.

**Now (Sat ~08:45): Ring 1 fan-out.** T0 contracts landed `9cefdf2` (D8 supply tier, D9 visitor identity). Authoritative assignment: [handoff/SYNTHESIS.md §8](handoff/SYNTHESIS.md). Merge gate: `node scripts/merge-gate.mjs` (stops on first red; test:unit can flake under load, rerun).
**Sessions (5):** lead junc26-18 (contracts, merges, lead agents for B-request, D-web, E-agent) · 8d Track A (core, A1→A4) · 9c Track G (visitor workspace, judge keys, ops, deploy) · 1f Track B retrieval · 91 Track F (evals + gate). C (kitchen visuals) starts on A2's fixtures.
**First shared milestone:** two browsers + an MCP client each complete the milk flow in their own workspace; Ops opens the exact plan.
**Open on the user's side:** `JUDGE_KEY_SECRET` in the Aiven console + local `.env`; yes/no on the 10-min Context.dev monitor (~144 credits/day); Exa submission decided at the 22:00 video checkpoint.

**Read these, in order:** DECISIONS (D4–D9) → SYNTHESIS §8 → your lane brief → CONCEPT/PRODUCT if new.

**Key facts (from the probes):** the Valio API ignores date and customer and is static (our simulator owns time and cut-offs); 18% of products are undeliverable; data has a `substitutions` field (250 rules); no product images; net weight 56% (89% with name parsing). Gemini key is `GEMINI_STUDIO_API_KEY`. Free NVIDIA API ~40 req/min per key; Context.dev 10 req/min. Venues: 3,560 Helsinki/Espoo/Vantaa venues from OSM in `data/venues/` (gitignored), [research/venues.md](research/venues.md).

**Platform submissions (created Fri night; no new ones can be created now, all editable until Sun 10:00):**
- Real drafts named `Mandate`: Valio Aimo (primary; 8 tech challenges ticked), Context.dev real-time web, Exa butler, AfterQuery break-the-agent, S-Pankki trainer.
- Placeholders named `PLACEHOLDER (Mandate)`: Cala, MariaDB, Tieto. They only keep a pivot open.
- Before Sun 10:00: set the real ones to **Final** (drafts are not reviewed); leave unused ones as drafts. One submission per challenge per project name. Drop "data stays in Finland" from the descriptions.

**Traps:**
- Lead owns the main checkout; other sessions must not switch branches there (junc26-a8 did once).
- `adapter-node@6` needs Kit 3: stay on ^5.5.8.
- Before going public: scrub the Valio API key and redeem codes from `docs/event/challenges/`, squash history, trim hallway quotes in `docs/research/mcpcon.md` (still uncommitted), check redistribution rights of Valio data (never committed).
- Whole team at peer review Sun 10:30; record a rough video Sat 22:00; solo, so the shift table in PLAN.md is out of date.
- Free NVIDIA API is ~40 req/min per key; Context.dev 10 req/min.
