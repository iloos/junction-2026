# Prompt: adversarial review, round 2 (same reviewer, more context)

_Paste everything below the line into the same session that wrote REVIEW-GPT-6.md and MULTI-CHALLENGE-STRATEGY-GPT-6.md. It's written for a reviewer who already knows round 1._

---

Round 2 of your adversarial review. Since your two reports, a lot happened that wasn't in the repo when you read it. Re-read what changed, then attack the **plan we're about to execute**, not the one you reviewed. Same stance: find what loses and what wins; be blunt and specific; cite files and lines.

## What happened since your reports (Sat 14 Nov, ~00:30 → ~02:45)
**Decisions** (read `docs/DECISIONS.md` D3–D5):
- **D4, big scope built in rings.** The user agreed with your sequencing but **rejected cutting the big version**. We build Kitchen, Operations, the open agent interface, web intelligence, Lab and Personal, but in rings 0→3. Integration is the gate: a ring counts only when a full journey works deployed.
  - There is no hardcode → JSON → SQL ladder: lanes build straight on the real stack, with a fixture path each.
  - Reopen trigger: Ring 0 not deployed by Sat ~10:00.
  - The user's stance: LLMs over-estimate effort for well-run agent lanes; it's fine if the full thing only comes together around halfway, as long as every part visibly moves the right way.
- **D5, service roles** from the foundation notes:
  - the Valio cache plus our simulator, which owns time, cut-offs and stock;
  - "unknown means hold";
  - Gemini Decisions for recipe fit and the grey zone only, with hard limits in code;
  - Gemma for simulated kitchens; Nemotron only once keyed;
  - Modal for jobs only;
  - Drizzle and Postgres (Aiven), with a PGlite snapshot as the fixture;
  - the MCP gate: scoped keys, approval bound to a terms hash and version, idempotent commits, cumulative caps;
  - Cloudinary only for a document workflow, or dropped;
  - no data-residency claim.
- **D3:** one container on Aiven Runtime, fallback a Verda VM. Not Vercel.

**From your round 1, we adopted:**
- the commitment protocol (snapshot, idempotency, cumulative caps, separate approval authority);
- quantity maths with stock, shown openly;
- 999999 = unknown, and missing data is never zero;
- honest demo metrics;
- the rejected-substitute hero beat;
- treating sponsor rows as evidence, not eligibility.

**Kept against your advice:** the big scope, now as rings; Gemini, because it's live-tested and the €4k prize is real; and a small Operations view as the first stretch goal.

**New evidence (read these):**
- `docs/foundations/`, all done:
  - `gemini.md`: the Decisions API is live-tested; 120 questions take about 0.56 s and cost about $0.001.
  - `models.md`: Gemma on Featherless works; **Nemotron has no endpoint yet**.
  - `modal.md`: fan-out measured; pack-size conflicts in 24% of cases where both sources give a size.
  - `data.md`: PGlite at 17.5k products works; Aiven Hobbyist in Helsinki.
  - `mcp.md`: a stateless v2 MCP server spike passes tests; MCP Apps untested in real hosts.
  - `ux.md`: the plan is the interface.
  - **`valio-data.md` + `valio-profile.json`:**
    - the API ignores date and customer and is static;
    - 18% of products are undeliverable;
    - **whole ham `462490` and lanttulaatikko `462482` really have 0 stock**;
    - the salmon shortage only holds if other kitchens contend for it;
    - there's a `substitutions` field with 250 rules;
    - no product images;
    - net weight for 56% of products (89% with name parsing);
    - no rate limiting observed.
- `docs/concept/PRODUCT.md`: personas, wedge (exceptions), buyer (Valio), 25 stories with **8 defining Ring 0**, 6 flows, 20 edge cases, a 4-week hotel pilot with thresholds, and 3 demo metrics.
- `docs/research/horeca-profiles.md`: 8 kitchen profiles (3 for the demo), Finnish seasonality from Statistics Finland, Slush on 18–19 Nov, working open-data sources (holidays, FMI weather, Linked Events, Jamix menus with portion grams, recall page), and a factor-with-source forecasting model.
- `docs/PLAN.md` "Now: rings" and "Later roadmap" (multi-user, memory, shared server work, many clients, no double orders).
- In progress, not in the repo yet: a venue dataset from OpenStreetMap, Exa and Context.dev (`data/venues/`, `docs/research/venues.md` when it lands).

**How the work is organised now:**
- The user is solo. The **lead session** owns the main checkout, merges, and is about to write the **contracts commit**: ARCHITECTURE.md, zod types, `applyOps`, the Drizzle schema, ports and fixtures, one tool registry → MCP + REST + OpenAPI, deps, the `core/` lint rule. It adds `workspaceId` + `actor` on every record.
- A **second peer session** works in its own worktree: `scripts/lane-setup`, `evals/` with the first 5 Ring 0 scenarios on real product IDs, and `fixtures/seeds/` (3 demo profiles, a Christmas buffet for 140, calendar factors). It will then review the contracts.
- **Five lanes** fan out after the contracts: core-db, agent, kitchen, ops, jobs. Web, Lab and Personal follow per D4.
- Coordination problems so far:
  - a peer session once switched branches in the shared checkout (now forbidden);
  - two sessions both numbered a decision D2 (fixed).
- **Platform:** 8 drafts exist, 5 real and 3 labelled placeholders. New submissions can no longer be created.

## Read (in this order)
`docs/STATUS.md` → `docs/DECISIONS.md` → `docs/concept/PRODUCT.md` → `docs/concept/CONCEPT.md` → `docs/concept/SCORECARD.md` → `docs/foundations/README.md` and each note (especially `valio-data.md`) → `docs/research/horeca-profiles.md` → `docs/PLAN.md` → `docs/ORCHESTRATION.md` → `CLAUDE.md`. You may read `data/valio/probe/*.json` (small) and `docs/foundations/valio-profile.json`; sample larger files with a script, never load them whole. **Do not read** `.env`, `Misc/` or `scratch/`. **Modify nothing** except your report.

## What I want from you
1. **Is the rings plan credible for a solo lead with agent lanes and about 27 hours left?** Where will it break first? Be concrete about the first 6–8 hours. Propose a schedule (hour by hour, Sat 03:00 → 11:00) with what must be true at each checkpoint, given that the user sleeps a few hours while lanes run.
2. **The contracts, before they're written:** what must be in them so 5 lanes don't diverge? Give a checklist:
   - entities, state machines (plan / line / approval / order), op types, port signatures;
   - the ranking formula, error and "unknown" semantics, concurrency (reservation, idempotency, versions);
   - fixture semantics, eval format;
   - what to leave out.

   Point out where our notes contradict each other.
3. **Ring 0 hero:** with the real data (ham and lanttulaatikko at 0, Valio's `substitutions` field, static API, no images), is the Christmas-for-140 rescue still the strongest opener? Write the 2-minute table demo and the 3-minute pitch arc around what's real. Say exactly what must be simulated, and how to label it.
4. **Multi-agent process risks:** two lead-capable sessions, 5 auto-mode lanes overnight, one merger. What goes wrong (contract drift, shared files, fixtures out of sync, eval flakiness, review bottleneck), and the cheapest guardrails?
5. **Challenge fit after the new evidence:** for each retained entry (Valio, Context.dev, Exa, AfterQuery, S-Pankki, plus Gemini, Modal, Verda, Aiven, Gemma, Cloudinary, Nemotron), say keep, stretch or drop now, and the single piece of evidence that would justify keeping it.
6. **What still loses**, ranked. And **one bold idea to win** that fits the rings without adding a new product.

## Output
Write `docs/review/REVIEW-GPT-6-ROUND2.md`, under about 3 pages:
- a verdict (≤5 lines);
- the schedule with checkpoints;
- the contracts checklist (including contradictions found);
- the hero demo and pitch;
- process guardrails;
- the keep / stretch / drop table;
- ranked risks, each with a fix and an hours estimate;
- the one bold idea.

Cite files and lines. If you're unsure, say how to check.
