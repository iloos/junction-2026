# Evals: Ring 0 scenarios

Each scenario is one JSON file in `scenarios/`. A runner loads its seeds, sets the simulated clock and overrides, plays the `steps` through the **same gate the app uses** (service functions or the tool registry, never UI), and then compares the **end state** with `expect`. Prose is a comment; only `expect` is checked.

Vocabulary follows [D6](../docs/DECISIONS.md): the six-digit Valio `productId` is the key; money is **integer cents** ex VAT (`catalogPrice.value` from the mock API, fetched 14 Nov 2026); quantities carry an explicit `unit`.

## File shape
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
  "steps": [ { "actor": "chef", "action": "request", "input": { … } } ],
  "expect": { … }
}
```

### Actors
`chef` (the kitchen's own user), `kitchen_agent` (internal routine agent; may act within the mandate), `external_agent` (outside MCP/REST client with a scoped key: may search, quote and place orders that always need approval; **never** approves), `approver` (the human approval authority, e.g. the chef's phone), `system` (simulator events: price or stock changes, clock moves).

### Actions
| action | input | meaning |
|---|---|---|
| `request` | `text`, `deliverBy` | natural-language order request |
| `plan_event` | `eventId` | expand an event seed into lines |
| `edit_line` | `dish` or `productId`, field, value | chef edits (e.g. g/guest); invalidates the quote and approvals |
| `search` / `quote` | `query` / `productIds[]` | read-only lookups |
| `place_order` | `lines[]`, `idempotencyKey` | creates a plan through the gate |
| `approve` | `ref` (line or order), `terms` | approval bound to the exact terms shown |
| `commit` | `ref`, `idempotencyKey` | commit approved or in-mandate lines into an order and receipt |
| `set_price` / `set_availability` | `productId`, value, `label` | simulator change after a step |
| `find_substitutes` | `productId`, optional `apply`, `requireOrigin`, `weights` | ranked substitutes for that product's line in the scenario's plan; preview or apply |
| `recall` | `productId` | system: a recall notice names the product (one RecordAnomaly, as the web lane's ingest writes it) |
| `set_clock` | `at` (ISO) | system: move the simulator clock (cut-offs, expiry) |
| `reset` | none | system: a fresh run on the same workspace and database, as the sandbox reset does |

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
| `lines[]` | each listed `{productId, qty, unit, state, tier?, reasons?}` must exist; `reasons` must include (not equal) the listed codes; `qty`/`unit`/cents exact |
| `rejected[]` / `unorderable[]` | products that must appear in that state with the reasons |
| `notProposed[]` | products that must not appear as a pickable option |
| `rank` | `{need, first}`: the top-ranked valid candidate for that need |
| `availabilityKinds` | productId → D6 kind as shown |
| `approvalStates` | the approval's state sequence |
| `commitResults[]` / `errors[]` | per attempt: `receipt`, or `error` with the D6 code and `retryable` |
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
| `attempts[]` | per `step` index: `action`, `result`, `error`, `retryable`, `applied`, `kind`; `chosen`/`notChosen` product ids; `closingNotBefore` (quote cut-offs) |
| `approval` | the newest plan's open approval: `{state, covers[], excludes[]}` by product id, or `null` for none |
| `orderLines[]` | committed order lines `{productId, authority: mandate \| approval}` |
| `previousRunKept` | ops of runs before the last `reset` are still in the database |

Line matchers also take `notState`, `notReasons` and `substituteFor`, `closingTime`; plan matchers take `minTotalCents`.

### Known gaps: `expectFail`
`"expectFail": {"F9": ["lines[463860]", "attempts[3]"]}` names result keys (or a key prefix such as `lines`) that must **still fail**, keyed by the SYNTHESIS finding id. Everything else must pass. When a listed key starts passing the eval goes red ("F9 looks fixed, delete this expectFail entry"), and a prefix that matches no result is red too. A lane that fixes a finding deletes its entry in the same merge; that is the one part of `evals/` other lanes may edit. Expected facts never depend on a search order: assert the property (`notChosen`, `kind`, `excludes`) rather than the current first result where retrieval may change it.

The runner reports pass/fail per key, so a partial build shows exactly which guarantee holds.

## Scenarios
| id | stories | what it proves |
|---|---|---|
| `s1-milk-over-cap` | ★1 ★4 ★5 ★6 | Valio's example order: priced, over the line and order caps → held → approved → one receipt even after a retry; Valio's own substitute rule skipped because it is undeliverable |
| `s2-christmas-plan` | ★2 ★8 | Event for 140 → kg → packs with lot/pack rounding; the g/guest edit recomputes; real outages and unknown quantities flagged, never counted as cover |
| `s3-salmon-below-lot` | ★3 | 9 kg left (simulated contention) is below the 10 kg lot step → salmon unorderable (`BELOW_LOT`); Finnish trout ranks first; the unreliable trout is visibly rejected |
| `s4-real-outages-stale-approval` | ★3 ★5 | Whole ham and lanttulaatikko really `out`, joulutorttu `undeliverable` → Terminal substitutes held as `UNKNOWN_REQUIRED`, a purchasable residual for the tarts; a price change invalidates the approval and the commit fails with `TERMS_CHANGED` |
| `s5-external-agent-split` | ★4 ★6 ★7 | Outside agent orders through the gate: approval-required, idempotent, `DUPLICATE` on a reused key with another payload; a split second order still hits `CAP_EXCEEDED.weekly`; an unknown id is `NOT_FOUND` and never reaches Valio |

| `s6`–`s11` | ★2–★6 | shipped since Friday: hard limit, recall rescue, usual-product baseline, scenario dates, substitute preview vs apply, sandbox reset |
| `r5-f5/f8/f9/f10/f11/f22` | review round 5 | one journey per finding, expected-fail until track A lands it |

Seeds live in `fixtures/seeds/`: `kitchens.json` (k-hotel, k-lounas, k-central), `christmas-buffet-140.json` (with a hand-checked `rescue` section: one Stock option per real outage), `calendar-factors.json`.
