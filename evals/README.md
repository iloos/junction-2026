# Evals

Every eval plays through the **same gate the app uses** (tool handlers on PGlite, or the request and agent entry points), never the UI, and checks the **end state**. Prose is a comment; only `expect` is checked. Everything runs offline: fixture LLM and parser, no network.

| Folder | What | Runner | Command |
|---|---|---|---|
| `scenarios/` | one journey per JSON file: s1–s5 and s7 (product stories), r5-f9, r5-f10 and r6-1…r6-5 (one per review finding) | `src/lib/server/evals/evals.test.ts` with `check.ts`; `node evals/run.ts` validates the files alone | `pnpm eval` |
| `fidelity/cases.json` | the same words through `/request`, the agent and REST `place_order` must give the same basket (properties, not first hits) | `src/lib/server/evals/fidelity.test.ts` | `pnpm eval` |
| `ui/*.e2e.ts` | judge journeys on the real screen (Playwright): Kitchen order summary counts and sums vs the order, receipt after reload, `g × guests = kg` arithmetic, an agent's approval link opens something approvable. Open defects by BUGS.md id in `KNOWN` (expected-fail; red once fixed) | `evals/ui/kitchen-order.e2e.ts` | `pnpm gate --full` (`KNOWN` tracks main); against prod: `KITCHEN_URL=<prod> npx playwright test -c evals/ui/pw-prod.config.ts` (no local server, so the worktree `.env` is never read) |
| `chat/free/sessions.json` | 15 messy chef messages (typos, EN/FI mixed, two items in a line, "what about the ham?", "make it 20 kg", "approve it", "cancel that", "how much have we spent") through the chat with the model: what each turn did (kind from ops/events), items by category and physical amount, plan continuity; always: no authority, no commit outside a continue, every € and decision count grounded in state. Checks `chat/free-check.ts` (self-tested) | `src/lib/server/evals/chat-free.test.ts`; model calls recorded/replayed at the Llm port by `replay-llm.ts` | live: `CHAT_LIVE=1 LLM_PROVIDER=gemini` (+`CHAT_RECORD=1` to record); gate: replays `chat/free/replay.json` once recorded |
| `chat/trials/*.json` | multi-turn chat sessions (chef turns + human approve/edit between): one question per missing field and never again, the chat never approves, "go ahead" continues the same plan with one receipt per key, an edit's voided approval is seen, the task ledger equals get_plan + receipts and the closing text claims nothing beyond it. Checks in `chat/check.ts` (self-tested in evals:self) | `src/lib/server/evals/chat.test.ts` (skipped until `src/lib/server/chat/turn.ts` exports `runChatTurn`) | `pnpm eval` |
| `paraphrase/cases.json` | English and Finnish phrasings per intent through `/request` and the agent: an order gives its fidelity case's basket, an event is read as a brief and buys nothing, a read question writes no plan | `src/lib/server/evals/paraphrase.test.ts` | `pnpm eval` |
| (in code) | one plan, three surfaces: `get_plan` FulfilmentView, the kitchen dish status and the Ops coverage count agree per need | `src/lib/server/evals/surfaces.test.ts` | `pnpm eval` |
| (in code) | adversarial regressions from the round 7–9 reviews (`docs/review/ROUND9-ADVERSARIAL.md`): each case asserts the correct behaviour (a grant after a partial continue buys the rest; a cancelled task orders nothing; "make it 20 kg" never buys litres; a lactose-free need never buys ordinary milk; a substitute replaces, not doubles; run normalisation; NOTIFY order and byte size; …) plus guards that held (same-key replay, `TERMS_CHANGED`, no outside approval). Open defects are in `OPEN` with an owner and run as `it.fails`: red once fixed, then the owner deletes the line. `ADV_SHOW=1` runs all plainly to show why each fails | `src/lib/server/evals/adversarial.test.ts`, `adversarial-transport.test.ts` | `pnpm eval` |
| `briefs/golden.json` | open event briefs through `/request`, every brief question answered, ending in a held plan with every course and diet | `src/lib/server/evals/briefs.test.ts` | `pnpm eval` |
| `menu/grounding-check.ts` | grounded menu: each golden brief's proposed menu, grounded by Exa cited recipes, has every dish sourced (cited http(s) recipes, each ingredient sourced/unsourced, what the sources add) or a reason it has none; grounding never changes the menu. Checker self-tested in evals:self | `src/lib/server/evals/menu-grounding.test.ts` (skipped until `src/lib/server/menu/grounding.ts` exports `groundMenu`, owner D) | `pnpm eval` |
| `retrieval/substitutes.json` `kind` | substitution kinds (1 same product other pack · 2 same base other brand · 3 other form · 4 functional): ranked by the real `find_substitutes` with the target out, a kind 1/2 candidate never sits below a kind-4 one (open targets in `OPEN`, owner 8d); kind accuracy ≥ 90% once candidates carry a kind | `src/lib/server/evals/substitute-kinds.test.ts` | `pnpm eval` (needs `data/valio/`) |
| (in code, opt-in) | substitute generalisation: leave-one-out on Valio's 250 substitution rules (recall@12, MRR, final rank) and coverage on a stratified sample of 100 food products; reports numbers, gates nothing | `src/lib/server/evals/substitute-generalisation.test.ts` → `scratch/subs-generalisation.json` | `SUBS_GENERALISE=1 pnpm eval` (needs `data/valio/`) |
| `agent/goals.json` | free-text goals played by the agent on a fresh workspace; expectations on domain state and the outcome | `src/lib/server/agent/goals.test.ts` | `pnpm eval:agent` |
| `retrieval/{substitutes,queries}.json` | labelled substitute targets (recall@12) and ingredient queries (precision@5) | `src/lib/server/adapters/catalog/retrieval*.eval.test.ts` | `pnpm test:unit` (skipped without `data/valio/`) |

`pnpm gate` runs all of the above in order (plus check, lint and the checker's own tests, `node --test evals/check.test.ts`) and stops on the first red; it is the merge gate. Live-model diagnostics over the agent goals and the fidelity cases are opt-in: `pnpm eval:live` (`src/lib/server/evals/live-planner.test.ts`, `AGENT_PLANNER=llm`). An eval here earns its place by crossing steps, entry points or surfaces; one module's behaviour belongs in that module's unit tests.

Vocabulary follows [D6](../docs/DECISIONS.md) and [VOCABULARY](../docs/concept/VOCABULARY.md): the six-digit Valio `productId` is the key; money is **integer cents** ex VAT (`catalogPrice.value` from the mock API, fetched 14 Nov 2026); quantities carry an explicit `unit`. Seeds are in [`fixtures/seeds/`](../fixtures/README.md).

## Scenario file shape
```jsonc
{
  "id": "s1-milk-over-cap",
  "title": "…",
  "stories": ["★1", "★4"],          // PRODUCT.md §2
  "edgeCases": [4, 6],               // PRODUCT.md §4
  "seeds": { "kitchen": "k-hotel", "event": "event-xmas-140" },   // ids in fixtures/seeds/
  "clock": "2026-11-14T12:00:00+02:00",                            // simulator time
  "state": { "weekSpentCents": 0, "priorOrders": [] },             // optional starting state
  "overrides": {                                                   // simulator layer on top of cached Valio data
    "availability": [{ "productId": "462150", "amount": 9, "label": "simulated: 34 kg committed by other kitchens" }],
    "price": []
  },
  "steps": [ { "actor": "chef", "action": "plan_event", "input": { "eventId": "event-xmas-140" } } ],
  "expect": { … }
}
```

### Actors
`chef` (the kitchen's own user), `kitchen_agent` (internal routine agent; may act within the mandate), `external_agent` (outside MCP/REST client with a scoped key: may search, quote and place orders that always need approval; **never** approves), `approver` (the human approval authority, e.g. the chef's phone), `system` (simulator events: price or stock changes, clock moves).

### Actions
| action | input | meaning |
|---|---|---|
| `plan_event` | `eventId` or `proposal` (a MenuProposal) | expand an event seed into lines |
| `edit_line` | `dish`, `ingredientId` (a proposal's stable id) or `lineId`, field, value | chef edits (e.g. g/guest); invalidates the quote and approvals |
| `search` / `quote` | `query` / `productIds[]` (optional `deliverBy`) | read-only lookups |
| `place_order` | `lines[]` (optional physical `amount`), `deliverBy`, `idempotencyKey` | creates a plan through the gate |
| `approve` | `ref` (`plan:<key>` or `{productId}`) | grants the plan's current approval on the terms `get_plan` shows |
| `commit` | `ref`, `idempotencyKey` | commits approved or in-mandate lines; a `{productId}` ref commits that product's lines only |
| `set_price` / `set_availability` | `productId`, value, `label` | simulator change after a step |
| `find_substitutes` | `productId`, optional `apply`, `requireOrigin`, `weights` | ranked substitutes for that product's line in the scenario's plan; preview or apply |
| `recall` | `productId` | system: a recall notice names the product (one RecordAnomaly, as the web lane's ingest writes it) |
| `set_clock` | `at` (ISO) | system: move the simulator clock (cut-offs, expiry) |

### Line states (D6)
`proposed → eligible | held{tier: propose|sign_off, reasons} | rejected | unorderable → committed`. "Acted" = committed by the agent within the mandate (tier `act`). `rejected` is a candidate refused by a rule (never a pickable option); `unorderable` means this product cannot be bought for this need at all.

### Approval states (D6)
`pending → granted | denied | expired | invalidated`. `approvalStates` lists the sequence a scenario must produce.

### Reasons (a line can carry several)
- **D6 error codes**, where a rule is the cause: `CAP_EXCEEDED.line | .order | .weekly`, `BELOW_LOT` (available < one lot), `UNKNOWN_REQUIRED` (Terminal 999999: quantity unknown, never counts as cover), `NOT_FOUND` (id not in the catalogue; rejected **before** any Valio call), `TERMS_CHANGED` (approval no longer matches), `DUPLICATE` (same idempotency key, different payload), `INSUFFICIENT_STOCK`.
- **D6 availability kinds**, when availability is the cause: `out` (amount 0), `undeliverable` (no schedule lines). The UI wording for the two must differ.
- **Policy reasons**: `new_sku`, `substitute_breaks_preference`, `origin_required`, `off_tender_list`, `allergen_unknown`, `low_reliability` (< 0.7), `external_agent_needs_approval`, `cutoff_passed`.

### `expect` keys
| key | checked how |
|---|---|
| `lines[]` | each `{productId, qty?, unit?, state?, tier?, reasons?, substituteFor?, notState?, historyStates?, historyReasons?}` must match one line; `reasons` must include (not equal) the listed codes; `qty`/`unit`/cents exact |
| `rejected[]` / `unorderable[]` | products that must appear in that state with the reasons |
| `notProposed[]` | products that must not appear as a pickable option |
| `rank` | `{need, first}`: the top-ranked valid candidate for that need |
| `availabilityKinds` | productId → D6 kind as shown |
| `wordingMustDiffer` | availability kinds whose UI words must differ |
| `approvalStates` | the approval's state sequence |
| `commitResults[]` / `errors[]` | per attempt: `receipt`, or `error` with the D6 code and `retryable` |
| `plans[]` | per plan key: `totalCents`, `state`, `tier`, `states`, `reasons` |
| `receipts` | exact count of receipts at the end |
| `duplicateReceipts` | always `0` |
| `sameReceiptOnRetry` | the retried commit (same key, same payload) returns the earlier receipt |
| `weekSpentCents` | cumulative committed spend for the kitchen at the end |
| `residualShortfall[]` | `{dish, kg or pieces}` the plan can't buy; `[]` means fully covered |
| `unconfirmedCover[]` | products whose quantity is unknown, so their dish counts as unconfirmed, never as covered |
| `ops.mustInclude[]` / `mustNotInclude[]` | D6 ops with actor, e.g. `{"op":"RecordApproval","actor":"approver","approvalState":"granted"}` |
| `valioCalls.neverInclude[]` | ids that must never be sent to the Valio API |
| `why` | for one line, the ordered steps the Why drawer must show |
| `tools.externalAgentMustNotHave[]` | tool names absent from the external agent's scope |
| `timing.recomputeMs` | upper bound for an edit → recompute |
| `attempts[]` | per `step` index: `action`, `result`, `error`, `retryable`, `applied`; `chosen`/`notChosen` product ids |
| `approval` | the newest plan's open approval: `{state, covers[], excludes[]}` by product id, or `null` for none |
| `qtys[]` | `{productId, qty[]}`: the exact multiset of quantities across that product's lines (two dishes sharing a SKU) |
| `fulfilment[]` | per need label from `get_plan` `plan.view.fulfilment`: `status` (one or a list), `unresolvedMin`, `confirmedMax`, `partition` (the five buckets sum to `required`) |
| `lastVoided` | `get_plan` `lastVoided.diff`: `includes[{productId, change}]`, `excludes[productId]` |
| `labels[]` | `{productId, mustSay}`: a shown label contains the text (e.g. "simulated") |

### Known gaps: `expectFail`
`"expectFail": {"F9": ["lines[463860]", "attempts[3]"]}` names result keys (or a key prefix such as `lines`) that must **still fail**, keyed by the finding id (`F<n>` from [SYNTHESIS](../docs/archive/handoff/SYNTHESIS.md) §2, or a review tag such as `R6-diff`). Everything else must pass. When a listed key starts passing the eval goes red ("F9 looks fixed, delete this expectFail entry"), and a prefix that matches no result is red too. A lane that fixes a finding deletes its entry in the same merge; that is the one part of `evals/` other lanes may edit. An `expectFail` entry also hides any other mistake in the same expectation (a wrong unit stays invisible until the fix lands), so check expectations under a marker against a probe of today's state first. Expected facts never depend on a search order: assert the property (`notChosen`, `excludes`, a category) rather than the current first result where retrieval may change it.

The runner reports pass/fail per key, so a partial build shows exactly which guarantee holds. The fidelity cases, the paraphrase intents and the briefs take the same `expectFail` per case; `surfaces.test.ts` keeps its list in code.

### Open gaps
None: every `expectFail` has been retired (A3-agent-cutoff, P1–P3, LATE-*, R6-lineage, F12-ops, A4 fixed by their lanes). A new gap gets a row here with its id, file, owner and what is missing. Prod defects found by hand are tracked in [docs/BUGS.md](../docs/BUGS.md) until they have a regression check.
