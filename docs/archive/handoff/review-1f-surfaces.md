# Review: 1f-surfaces (baseline, SURFACES, product shape)

Target main `f2edb21`. Deployed URL walked Sat 14 Nov ~03:55 (desktop 1440 and phone 390, Playwright; screenshots in 1f's scratchpad). Read-only apart from this file.

## 1. Own scope
**Solid**
- **Standing-order baseline.** A fresh Christmas run holds new products only.
  - Tests: `baseline.test.ts` (4 tests), and `view.test.ts` with salmon `commit` before and `none` after approve and commit.
  - **Deployed:** 10 held, 4 "Within mandate", against 14 held before the merge.
- **One `orderedBefore`** in [tier.ts](../../src/lib/core/mandate/tier.ts). The duplicates in events.ts and orders.ts are gone.
- **Backfill of existing workspaces.** `ensure` sets `doc.usualProducts` only when it is missing ([drizzle-store.ts](../../src/lib/server/store/drizzle-store.ts)). The test proves mandate edits survive.
- **Commit with approval buys approved lines plus act-tier lines** ([orders.ts:375–445](../../src/lib/core/services/orders.ts#L375)). Without this, the baseline would have left in-mandate lines unbought and stuck behind "no open line". 8d is reviewing it.

**Fragile, and shortcuts taken**
- **Only k-hotel has a baseline.** For k-lounas and k-central, every product is still "new", so any request there is held. Not tested on those kitchens.
- **The baseline is the normal week, not order history.** Event-only items (herrings, rosolli, casseroles) stay "new product" (8 of the 10 held). A hotel that runs Christmas buffets bought them last year. The real source is the kitchen's Valio order history: the webshop already has *Usein ostetut* (frequently bought) and *tilauspohjat* (order templates); see [valio-baseline](../research/valio-baseline.md).
- **The backfill only fills a missing field.** A later change to the seed's baseline won't reach existing workspaces.
- **`NORMAL_WEEK` throws at module load** if the seed and its quantities disagree. That is fail-loud by design, but a seed edit can crash the kitchen bundle.
- **A mixed commit records `authority: {approvalId}` for in-mandate lines too.** The audit trail can't tell "approved" from "agent within mandate" per line.
- **Untested:** the mixed commit on real Postgres (`test:pg`), and external caller + act lines (guarded by `actAlone`, but no test).
- **The offline fixture disagrees with core.** `stub-handlers.ts:294` flags `new_sku` only for substitutes; core flags any product not ordered before. The offline demo and the live demo therefore hold different lines.

**My docs that are already out of date**
- [sibling-repos](../research/sibling-repos.md) cites findings C and D as open (`loop.ts:68`). Main now has the abort signal, `GoalOutcome`, intent-scoped tools and `RunPrincipal` (`stop.test.ts:37`, `:85`, `:123`).
- [SURFACES](../concept/SURFACES.md) §3 still says 14 held.
- Still open from sibling-repos: decision provenance (a prompt hash, model and rubric version on each decision). `grep promptHash` finds nothing.

## 2. Adjacent scopes
- **Ops defaults to `ws-demo`, the kitchen to `ws-judges`.**
  - Public kitchen sessions get the judges' sandbox ([live.ts:62–67](../../src/lib/server/kitchen/live.ts#L62)); `/ops` defaults to `ws-demo` ([ops/+page.server.ts:49](../../src/routes/ops/+page.server.ts#L49)).
  - **Observed:** after planning in the kitchen, `/ops` shows "No orders in this workspace yet · seq 0". The plan appears only under the "Judges' sandbox" tab.
- **The two screens count held lines differently.** Kitchen: "10 lines held · 3 outages". Ops (sandbox): "13 held for a person". Same plan, different numbers.
- **Approval is one press for every reason.** The review panel groups by reason (*new product* vs *new product · allergen change*), but "Hold to approve 10 lines" grants the whole group at once. An allergen change rides with routine new products, which is the rubber-stamp risk SURFACES §4 *Decision* was meant to remove.
- **Availability shows plain "unlimited"** on `/request` (milk 464201). D6 says that sentinel is an assumption until a mentor confirms it. The label should say "assumed".

## 3. The product as a judge sees it
**What holds up**
- **`/request` milk example, live:**
  - Gemini Flash-Lite parse in 717 ms (275 in / 129 out tokens).
  - The date is reasoned from the simulated clock, with an explicit correction ("model read 07 Dec; using 14 Dec").
  - Lookup in 147 ms; Valio's own substitute rule is skipped with a reason.
- **Edit after rescue, deployed:** ham 135 → 120 g recomputes 27.0 → 24.0 kg, the substitute resizes 13 → 12 ST, and the earlier approval is voided with "Review what changed". This is PITCH's withheld beat.
- **No console errors on either viewport.**

**What breaks first, ranked**
1. **Shared sandbox.** Every public visitor lands in one `ws-judges` plan. A fresh browser context saw the plan an earlier session had started: no start button, planned in 14 ms.
   - During peer review (10:30–14:00, many QR visitors), one judge's gram edit voids another judge's approval, and "Start over" resets the sandbox for everyone.
   - A redeploy also reset it: after the `f2edb21` deploy the start button was back.
2. **Empty Ops after planning** (section 2). The "same held lines in Operations" beat fails unless someone clicks the sandbox tab.
3. **No agent door.** `/agents` returns 404. `/mcp` without a key returns 401 FORBIDDEN, with no public way to get a judge key. Story ★7 and Openness (15%) depend on the presenter.
4. **Kitchen and Ops counts disagree** (10 vs 13).

**PITCH vs the code**
- **Its "Do not claim" list is out of date.**
  - The round-3 P0s have tests: duplicate lineIds `gate.test.ts:76`, the five hard validator cases in `gate.test.ts`, and a missing price as a gap in `view.test.ts`.
  - Finding 4 (edit after rescue) has `rescue.test.ts` and is seen deployed.
  - With those test names cited, PITCH can claim an enforceable mandate and the co-planning beat.
- **Still not claimable:** "recipe-aware" ranking (no labelled fit set), and decision reproducibility (no provenance).

**Still open from docs/review and docs/reviews**
- Round 4 agent G: no labelled live-model trial suite.
- F: no fit eval.
- E: typed facts to the planner, and the planted-injection eval are unverified by me.
- Systems 5–8 (durable enrichment jobs, OfferContext): contract only, as triaged.
- UX 3 (mobile compare cards) is not re-checked: the phone kitchen is still a long single scroll, with the review panel near the bottom behind a sticky bar.

## 4. Continuation
**Next tasks, ranked by demo risk × effort**
1. **A sandbox per visitor, or labelled and isolated per QR code, plus Ops opening the visitor's workspace** (S–M; kitchen + ops). Peer review is where this breaks.
2. **Open request → menu → ingredients** (PLAN.md), with retrieval built first. Step 4 (ingredient → product) cannot work on the current candidate generation: same category ordered by product id, cut to 12 ([pg.ts:146](../../src/lib/server/adapters/catalog/pg.ts#L146)). The hybrid retrieval in `lanes/subs-retrieval.md` (lexical ∪ Gemini embeddings into the unused `products.embedding` ∪ Valio rules, then fact filters) is the shared base for request lookup, menu ingredients and substitutes. Build it first, inside this track.
3. **Agent door** (`lanes/agent-door.md`): tool results carry `summary`, `nextAction` and `approvalUrl`; plus `/agents` and a judge key path. This is Openness 15% and the external-agent beat.
4. **One approval per judgement:** split allergen-change (and other sign-off reasons) from routine new products in the review panel, so each is granted separately. Kitchen, S.
5. **Baseline from history:** read `usualProducts` from the run's committed orders plus a seeded "last season" list, so event staples stop being "new". Also give k-lounas and k-central baselines.

**How my §9 proposals rank against the open-request track**
- **Above it:** item 1 (it isn't a §9 slice; it's a demo bug).
- **Inside it:** subs-retrieval and composer (the composer is its input surface; build it as the track's UI rather than separately).
- **After it:** agent-door, which is parallel and small, and can run now if a session is free.
- **Later:** ops-cases by cause, then images. The images chain is measured (14/50 verified), but its scripts and verdicts live only in 1f's scratchpad. Copy `chain.py` into `scripts/images/` when the lane starts.

**Risks**
- Gemini spend for embeddings (17.5k products) needs a cap set before the batch.
- The deploy-resets-sandbox behaviour during peer review.
- Each new kitchen without a baseline holds everything.

**Disagreement:** none with D1–D7. One process note: the event-only staples problem argues for treating "known products" as data from order history (Valio's *Usein ostetut*), not as a mandate setting.
