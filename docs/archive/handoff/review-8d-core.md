# Review: 8d-core (core-db: mandate, ranking, orders, store) at main f2edb21

## 1. Own scope

**Solid (with evidence)**
- **Validator is shared by tiering, ranking and commit** (`core/mandate/validate.ts`). Hard limit: `ceiling.test.ts` (€2.7M juice forbidden at place and at commit, both default and explicit lineIds; an order split under the per-line limit but over it in total). Duplicate lineIds, null price and unknown stock at commit: `orders.test.ts`, `gate.test.ts`.
- **Prepare outside the lock:** prefetch, then the version is re-checked in the tx (`prepare.test.ts`). The Postgres double-commit race passes 4/4 on Aiven, but only when opted in with `pnpm test:pg` (`pg-race.test.ts`).
- **Seeded-dish pool:** `pool.test.ts` fails without the fix and passes with it. No graham pie for lanttulaatikko, no pork kidney for the ham under price-first.
- **Recall** (hold, void, sticky, superseded): `recall.test.ts`. **Enrichments** latest wins and survive a new run: `enrichments.test.ts`.
- **Scenario dates:** `scenario.test.ts`, and the `dates.test.ts` invariant `SCENARIO.cutoff` = the earliest line cut-off (Tue 8 Dec 15:00), which is after the start.
- **Suites:** server 247 passed / 7 skipped; core 41 passed. Prod MCP as judge1, measured: no approve tool, place_order held, commit before approval → FORBIDDEN approval_required.

**Fragile / known bugs**
1. **Lanttulaatikko's recommended rescue is unknown supply.** The pool fix makes 462157 (6×400 g, Terminal, `availability.kind unknown`) rank 1. The seed's intended rescue is make-in-house (`christmas-buffet-140.json`, `rescue["lanttulaatikko-462482"].chosen = make_in_house`). The view is honest (unconfirmedCover), but the chef is offered a rescue that covers nothing confirmed. Ranking prefers any orderable product over make-in-house; it should prefer confirmed cover (or make-in-house) when the alternative is `unknown`. Not verified on prod after the pool merge. On prod before it, graham pie outranked 462157, which suggests the pg and file catalogs disagree on 462157.
2. **`qty_implausible` uses only its fallback.** `expectedQty` (20× dish need) has no caller (`validate.ts:25`, grep shows no caller). Only the 500× largest-pack rule fires, so 50× a dish need passes silently.
3. **The Decide memo has no test** (`adapters/decide/index.ts`, `remembered`). A cache hit reports the original `latencyMs` as if the call had happened. Fit is skipped with fewer than 2 survivors, so a single survivor shows no fit score.
4. **ensurePlan rescues are still sequential** (each apply bumps the version). The first plan per kitchen pays fit once per outage. Plan → visible was 7.07 s on 39ef642 (9c); not re-measured after 2d8ce0f.
5. **`quote` without deliverBy keeps November dates** (`onScenario` runs only when deliverBy is given). MCP clients can omit it.
6. **The hard limit counts the whole open order, held lines included** (`tier.ts`, hard-limit loop). k-central: €16,000; k-hotel: €8,000. A legitimately large event is forbidden whole, with no partial path.

**Shortcuts:** the race test is not in the default run and there's no CI (`.github/workflows` absent). Fit has no labelled set (round-4 agent F), and nothing claims "recipe-aware", which is correct. A recall doesn't re-quote automatically (lead ruling).

## 2. Adjacent scopes

- **Baseline commit change (1f, `orders.ts` ~375–440)**, reviewed as asked:
  - **Audit misstates authority.** With a granted approval, `selected = granted.lineIds ∪ actIds`, and the order records `authority: { approvalId }` for every line. The act lines were never covered by that approval's lineIds/termsHash, so the receipt says a human approved lines no human saw. Fix: per-line authority on `Order.lines`, or two orders (mandate + approval) in one commit.
  - **No test of the mixed commit.** `baseline.test.ts` has 0 `commit_order` calls, and nothing asserts `granted ∪ act` or the authority.
  - **Weekly cap is safe in practice, but nothing tests it.** The weekly-cap check sits only in the `inMandate` branch. Act lines in the mixed branch rely on tiering (the order/weekly totals cover all orderable lines) and on the `demoted` check. Correct today, but untested.
- **/request:** sign-off still needs no key. Below the hard limit, anyone with the URL can approve and commit up to €8,000 in ws-judges. The kitchen UI is the same: on the web, the cookie session is the chef. PITCH's "outside agents can never approve" holds for keys only. Say "sandbox" on stage.
- **/ops queue deadlines** now read each line's `closingTime` (69bb2ff). That is only right because both catalog adapters apply `onScenario`. Any new offers path must apply it too.
- **Contract additions this round:** PolicyReason `over_hard_limit`, `qty_implausible`; `Mandate.hardLimitCents?`; `Availability.provenance.note` carries "scenario dates…". UI labels were added in `ui/reasons.ts` and `ops/labels.ts`; the request lane's copy was updated in 6ba72e5.

## 3. The whole product

- **PITCH is stale against the code:**
  - The demo table still marks ranking `[ ] slice 4` and "the request box is missing". Both are live.
  - The **"Do not claim" list** (`PITCH.md:45`) bars "an enforceable mandate" until the round-3 P0s land. Those are fixed with tests (§1). The new claim "a hard ceiling no approval can pass" is backed by `ceiling.test.ts`.
  - "One verified feasible replacement" holds for the ham (palvikinkku 476768, Stock). It does **not** hold for lanttulaatikko (§1.1).
- **What a judge breaks first:**
  1. Approves anything in the web sandbox; there is no key, by design.
  2. An open request ("5-course dinner for 50") gets no plan. An unseeded dish falls back to category neighbours, which is the graham-pie class of answer.
  3. An MCP quote without deliverBy shows November cut-offs.
  4. "Why is the casserole rescue qty unknown?"
- **Open in docs/reviews:**
  - Round-4 Ring 0 items for core (#1, #4) are done.
  - Ring 1–2 is not built: enrichment job lifecycle (only persistence exists), the four eval suites (`server/evals` is s1–s5 only; adversarial-authority exists separately), and a labelled fit set.

## 4. Continuation (my next tasks, by value)

1. **Rank confirmed cover above unknown supply:** prefer make-in-house or a Stock option over Terminal `unknown` for event rescues, with a test on lanttulaatikko. Then smoke it on prod.
2. **Make the mixed commit tell the truth:** per-line authority (or split orders) plus a test of `granted ∪ act`. Contract edit, so the lead decides.
3. **Wire `expectedQty`** from plan needs into tiering, so `qty_implausible` means 20× the dish need. Default `deliverBy` in `quote` to the scenario delivery.
4. **Pool for unseeded dishes** (feeds the PLAN open-request track): ingredient template → candidates by name/category match plus Valio rules, with a minimum lexical or fit match instead of the first 12 ids of a category. Without this, the menu → ingredients layer reproduces the graham-pie bug for every new dish.
5. **Run the pg race test in the deploy smoke,** or add a minimal CI. Add a unit test for the Decide memo.

**Disagreement (mild):** a single line over the hard limit is forbidden by the validator before totals, so it never takes a valid basket down with it. But when many lines that are each under the limit add up past it (a real large event), the whole order is forbidden, with no "commit up to the limit" path (`tier.ts`). I'd keep it for now, and give the explanation copy "split the order or raise the mandate" before anyone demos a big event.
