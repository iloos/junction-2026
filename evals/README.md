# Evals: Ring 0 scenarios

Each scenario is one JSON file in `scenarios/`. A runner loads its seeds, sets the simulated clock and overrides, plays the `steps` through the **same gate the app uses** (service functions or the tool registry, never UI), and then compares the **end state** with `expect`. Prose is a comment; only `expect` is checked.

Field names are deliberately plain and will be aligned with `src/lib/core` types when the contracts land. Ids are real Valio product ids (strings); prices are `catalogPrice.value` ex VAT from the mock API, fetched 14 Nov 2026.

## File shape
```jsonc
{
  "id": "s1-milk-over-cap",
  "title": "…",
  "stories": ["★1", "★4"],          // PRODUCT.md §2
  "edgeCases": [4, 6],               // PRODUCT.md §4
  "seeds": { "kitchen": "k-hotel", "event": "event-xmas-140" },   // ids in fixtures/seeds/
  "clock": "2026-11-14T12:00:00+02:00",                            // simulator time
  "state": { "weekSpentEx": 0, "priorOrders": [] },                // optional starting state
  "overrides": {                                                   // simulator layer on top of cached Valio data
    "availability": [{ "sku": "462150", "amount": 9, "label": "simulated: 34 kg committed by other kitchens" }],
    "price": []
  },
  "steps": [ { "actor": "chef", "action": "request", "input": { … } } ],
  "expect": { … }
}
```

### Actors
`chef` (the kitchen's own user), `kitchen_agent` (our agent, acts within the mandate), `external_agent` (outside MCP/REST client with a scoped key: may search, quote, place pending orders; **never** approve), `approver` (the human approval authority, e.g. the chef's phone), `system` (simulator events: price or stock changes, clock moves).

### Actions
| action | input | meaning |
|---|---|---|
| `request` | `text`, `deliverBy` | natural-language order request |
| `plan_event` | `eventId` | expand an event seed into lines |
| `edit_line` | `dish` or `sku`, field, value | chef edits (e.g. g/guest) |
| `search` / `quote` | `query` / `skus[]` | read-only lookups |
| `place_order` | `lines[]`, `idempotencyKey` | creates a pending order through the gate |
| `approve` | `ref` (line or order), `terms` | approval bound to the exact terms shown |
| `commit` | `ref`, `idempotencyKey` | turn approved/acted lines into an order and receipt |
| `set_price` / `set_availability` | `sku`, value, `label` | simulator change after a step |

### Line states (closed set)
`acted` (inside the mandate, committed without asking) · `held` (waiting for a human; `tier` is `propose` or `sign_off`) · `rejected` (a candidate refused by a rule; never shown as an option to pick) · `committed` (on a receipt) · `unorderable` (cannot be bought at all for this need).

### Reason codes (closed set; a line can carry several)
`over_line_cap`, `over_order_cap`, `over_weekly_cap`, `new_sku`, `substitute_breaks_preference`, `origin_required`, `off_tender_list`, `allergen_unknown`, `unknown_quantity` (Terminal 999999), `out_of_stock` (amount 0), `undeliverable` (no schedule lines), `below_lot_step` (available < one lot), `low_reliability` (< 0.7), `unknown_product` (id not in the catalogue; rejected **before** any Valio call), `approval_stale_terms`, `external_agent_needs_approval`, `cutoff_passed`.

### `expect` keys
| key | checked how |
|---|---|
| `lines[]` | each listed `{sku, qty, unit, state, tier?, reasons?}` must exist; `reasons` must include (not equal) the listed codes; `qty`/`unit` exact |
| `rejected[]` | candidates that must appear as `rejected` with the reasons |
| `notProposed[]` | skus that must not appear as a pickable option |
| `rank` | `{need, first}`: the top-ranked valid candidate for that need |
| `receipts` | exact count of receipts at the end |
| `duplicateReceipts` | always `0` |
| `sameReceiptOnRetry` | the retried commit returns the earlier receipt id |
| `weekSpentEx` | cumulative committed spend for the kitchen at the end (±0.01) |
| `residualShortfall[]` | `{dish, kg}` still uncovered; `[]` means fully covered |
| `unconfirmedCover[]` | skus whose quantity is unknown, so their dish counts as unconfirmed, never as covered |
| `ops.mustInclude[]` | op types with actor that must be in the op log, e.g. `{"type":"order.placed","actor":"external_agent"}` |
| `valioCalls.neverInclude[]` | ids that must never be sent to the Valio API |
| `why` | for one line, the ordered steps the Why drawer must show |
| `tools.externalAgentMustNotHave[]` | tool names absent from the external agent's scope |
| `timing.recomputeMs` | upper bound for an edit → recompute |

The runner reports pass/fail per key, so a partial build shows exactly which guarantee holds.

## Scenarios
| id | stories | what it proves |
|---|---|---|
| `s1-milk-over-cap` | ★1 ★4 ★5 ★6 | Valio's example order: priced, over the order cap → held → approved → one receipt even after a retry; Valio's own substitute rule skipped because it is undeliverable |
| `s2-christmas-plan` | ★2 ★8 | Event for 140 → kg → packs with lot/pack rounding; the g/guest edit recomputes; real outages and unknown quantities flagged, never counted as cover |
| `s3-salmon-below-lot` | ★3 | 9 kg left (simulated contention) is below the 10 kg lot step → salmon unorderable; Finnish trout ranks first; the unreliable trout is visibly rejected |
| `s4-real-outages-stale-approval` | ★3 ★5 | Whole ham and lanttulaatikko really at 0 → substitutes held as unknown quantity; undeliverable ≠ out of stock; a price change voids the approval |
| `s5-external-agent-split` | ★4 ★6 ★7 | Outside agent orders through the gate: pending, approved by the human, idempotent; splitting into a second order cannot dodge the weekly cap; an unknown id never reaches Valio |

Seeds live in `fixtures/seeds/`: `kitchens.json` (k-hotel, k-lounas, k-central), `christmas-buffet-140.json`, `calendar-factors.json`.
