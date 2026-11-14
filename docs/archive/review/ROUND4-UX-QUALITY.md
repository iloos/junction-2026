# Round 4: user journeys, surfaces and nationwide UX quality

Method: source-based product/UX review, not a completed visual/a11y certification. Snapshot began at `c834e98` and key seams were rechecked at `451a713`, 14 Nov 2026; main and live-flip work continue during review. Impeccable context and Operate guidance were used. The launcher does not discover canonical `docs/concept/PRODUCT.md` because it looks for root PRODUCT/DESIGN; no root artifact was created. Product facts come from the canonical repo docs. No application files, branches or shared data changed. Questions skipped: subagent research brief; parent owns synthesis and any user clarification. No rendered-page observation is claimed here; parent's deployed-browser attempt failed because the browser host was unavailable.

## Direction: three operational surfaces, not three decorative dashboards

The existing concept has a sound distinction: the chef acts on an order; Valio acts on exceptions across kitchens; an outside agent uses the gate. Keep it. Add an explicit **administration** boundary: changing policy/catalogue truth or granting credentials is different from handling today's shortages. The public demonstration can share components; the product must not share authority merely because the pages look related.

| Surface | User's real job | Primary object | Completion, not presence |
|---|---|---|---|
| Kitchen | Get service supplied without buying the wrong amount | Delivery plan, event diff, review package, receipt | Required meals are confirmed, unresolved needs remain explicit, or the chef consciously revises the menu |
| Operations | Find and resolve the most consequential problems before cut-off | Ranked exception queue → affected plans → resolution | An incident moves from unassigned to owned, acted on and closed with evidence |
| Admin/data stewardship | Make the system safe and usable for a kitchen/region | Versioned policy, connections, data-quality review | A governed change is validated, published and attributable; old approvals are handled correctly |
| Agent developer | Connect and complete a permitted transaction | Tool schema, scoped credential, test request, approval link | Client obtains a real receipt or an actionable refusal through the same service |

**The improvement is a complete decision loop per surface.** A line chip, map, chatbot or event stream is an affordance, not evidence that the user's job can be completed.

## What is already specific and worth preserving

- The plan is the interface: dishes, portions, lots, prices and reasons are visible in the kitchen source ([page:232](../../src/routes/(kitchen)/+page.svelte#L232)). This is stronger than a chat transcript or a generic catalogue.
- Exact-term review and invalidation have dedicated UI ([ApprovalPanel:77](../../src/routes/(kitchen)/ApprovalPanel.svelte#L77)); the Why drawer builds a chain of inputs and sources ([WhyDrawer:62](../../src/lib/ui/WhyDrawer.svelte#L62)). Preserve domain facts before technical trace details.
- State chips use text and symbols, not colour alone; Operations has connection/reconnection states and labels the synthetic workspace ([ops:78](../../src/routes/ops/+page.svelte#L78), [185](../../src/routes/ops/+page.svelte#L185)). These are good foundations for trust.

## Current UX seams that need explicit acceptance gates

### 1. Server authority and the UI's vocabulary must agree

**Progress in `451a713`:** the live-flip added a server-side kitchen view model and changed `ApprovalPanel` to include held lines covered by granted approval ([line 44](../../src/routes/(kitchen)/ApprovalPanel.svelte#L44)). The earlier disabled-commit mismatch is addressed in source. `StateChip` still checks held state before its `approved` prop ([22](../../src/lib/ui/StateChip.svelte#L22)), so a granted line can retain a Sign-off/Proposed chip even while the approval card permits commitment.

The live-flip also fixes recognition of `UNKNOWN_REQUIRED` ([StateChip:73](../../src/lib/ui/StateChip.svelte#L73)). It still labels that generic reason as “Qty unknown,” which is wrong for missing *price* or *dietary evidence*. They imply different actions and different effects of approval. The new live comparison also treats preview rank 1 as chosen ([live-view:117](../../src/lib/kitchen/live-view.ts#L117)); a changed preview must not imply that the actual purchase changed.

**Quality gate:** render a server-derived read model with `reviewable`, `committable`, `confirmedCover`, `unconfirmedCover`, `blockedReason`, and `nextAction`; don't reconstruct authority from CSS-facing labels. Test all states: no approval, pending, granted, denied, invalidated, expired, partial commit and awaiting supplier. Each state must have a truthful primary action or explanation. Do not claim all these are observed failures of the in-flight live flip; they are current source seams it must resolve.

### 2. Review must show consequences, not primarily cryptography

The current card gives plan version/hash/mandate a large block ([ApprovalPanel:134](../../src/routes/(kitchen)/ApprovalPanel.svelte#L134)). Those are useful audit details, but the chef first needs: what changed, why it is outside policy, total/price basis, delivery, confirmed quantity and unresolved consequences. Expiry is currently formatted with a fixed `17:00` after slicing the date ([152](../../src/routes/(kitchen)/ApprovalPanel.svelte#L152)); that must come from the actual timestamp.

**Quality gate:** an unfamiliar reviewer can state the proposed purchase and remaining shortfall without opening technical trace details. “Approve” does not visually imply “supplier confirmed.” After a stale approval, highlight the changed fields and require reviewing those changes; merely saying “terms changed” makes the user rediscover them.

### 3. Mobile needs a different comparison layout, not a shrunken desktop table

The rescue table has a 720 px minimum width ([RescuePanel:44](../../src/routes/(kitchen)/RescuePanel.svelte#L44)). Horizontal scrolling can preserve a secondary detail table, but it is a weak primary decision surface at 390 px: a chef must connect candidate, availability, cost, coverage and verdict across off-screen columns.

**Quality gate:** on a phone, three candidate summaries are readable as stacked cards with the same ordered facts and explicit “compare details.” Keep verdict, complete price basis and confirmed coverage in each card; preserve chosen-vs-preview distinction. Product text truncation must have a reliable expansion path. Keyboard and touch users must reach the same decision without dragging a wide table.

### 4. Operations shows state but does not yet complete oversight work

The current board maps the seeded kitchen list into columns ([ops:42](../../src/routes/ops/+page.svelte#L42)); a Ticket is a non-interactive article ([Ticket:12](../../src/routes/ops/Ticket.svelte#L12)). The documented story promises “click a kitchen → its exact plan” ([PRODUCT:37](../concept/PRODUCT.md#L37)). Three kitchen columns work as a demonstration, but scaling them to 500 or Finland produces a monitoring wall, not a work queue.

“Nothing held. The agent is inside its mandate” ([ops:233](../../src/routes/ops/+page.svelte#L233)) also conflates absence of held lines with successful fulfilment. Missing/rejected data, lost history or an unplaced order may leave nothing held.

**Quality gate:** default Operations to urgency/impact-sorted cases with filters for deadline, region, kitchen segment, cause and state. One case links to an exact plan/version/need; show owner, age, next step and outcome. “Clear” requires explicit coverage/fulfilment evidence. Keep a wallboard mode for viewing from three metres, but do not make it the operator's only working view.

### 5. Accessibility has to cover the critical action, not just labels

The hold-to-approve control supports pointer hold and Enter/Space key hold ([HoldButton:36](../../src/lib/ui/HoldButton.svelte#L36)) but has no click activation path ([44](../../src/lib/ui/HoldButton.svelte#L44)). Assistive technology often activates a button through click rather than delivering a physical key hold. Holding also adds motor/timing burden. The progress timer needs cancellation on focus loss/unmount. This is a source-level risk requiring keyboard/screen-reader confirmation, not a measured accessibility result.

The grams stepper has 28 px-wide buttons ([GramsStepper:28](../../src/lib/ui/GramsStepper.svelte#L28)), no busy/disabled prop, and immediate blur/arrow submissions. The rules radiogroup uses button roles without a radio-keyboard interaction model ([RulesPanel:31](../../src/routes/(kitchen)/RulesPanel.svelte#L31)).

**Quality gate:** provide a standard accessible “Review → Confirm exact terms” flow as an alternative to hold; define focus destination after success/error and lock the exact displayed terms while confirming. Stepper interactions coalesce or serialize, with a visible pending value and a recoverable stale-version outcome. Test keyboard-only, virtual activation, reduced motion, zoom, long Finnish/Swedish names and the phone viewport. Do not equate `aria-label` presence with completion.

### 6. Source honesty should be data-driven, not manually maintained copy

The page supplies a hardcoded cached time ([page:78](../../src/routes/(kitchen)/+page.svelte#L78)); the Why footer hardcodes “cached 14 Nov” ([WhyDrawer:85](../../src/lib/ui/WhyDrawer.svelte#L85)). As more kitchens and sources arrive, these labels will drift. The same issue affects fixture assumptions presented beside real imported venue names.

**Quality gate:** each plan has a compact source/status summary derived from its records: live/cached/replay/simulated, observed time, freshness, and any unknown required fields. Details link to the exact source field. Never let a global “live” badge imply every displayed value is live or verified.

**New live-flip recovery seam:** [backend.ts:12](../../src/lib/kitchen/backend.ts#L12) permanently switches the browser to its local fixture when snapshot retrieval fails, including a server error or authorization failure. A banner can identify fixture mode, but it cannot preserve the user's shared live order. Keep the last live state read-only with retry/status first; entering an offline demonstration should be explicit, isolated, and discard/retain intent clear. Reconnection must not merge independent local purchases into the live plan. Similarly, the kitchen's `scenario('reset')` presently clears preset/overlay, not the new server run ([live.ts:217](../../src/lib/server/kitchen/live.ts#L217)); “Reset demo” must have one meaning across Kitchen and Ops.

## Eight journeys that make the pillars good

| Story | Observable acceptance |
|---|---|
| Chef requests milk, but “Monday” is ambiguous | Show interpreted delivery date and quantity/unit before placing; ask one focused question when needed; retain the draft after failure |
| Chef edits a dish after a substitute is proposed | Active substitute/ingredient quantities, rounding, cost and residual portions recompute; old approval is invalidated; before/after fields are visible |
| Chef refuses a recommendation | State remains safe; let them choose another option or revise menu; do not re-propose the same item immediately; distinguish “decline” from “cannot fulfil” |
| Purchaser returns after partial commitment | Open requirements and committed lines are distinct; no duplicate purchase; receipt and supplier-pending lines remain findable after reload |
| Another client changes terms during review | Confirm fails safely; show the exact difference, preserve user intent and move focus to review—not a generic red toast |
| Operator investigates a regional shortage | Filter affected kitchens; open an exact need; identify owner/next step; resolution updates the chef and audit trail without granting ops kitchen approval authority |
| Data steward resolves an uncertain pack size | Compare raw sources and packaging levels; publish a versioned verified correction; affected drafts are revalidated; never silently rewrite approved orders |
| Outside agent requests an order | Gets structured pending/blocked result plus approval URL; human sees actual terms and identity; agent cannot approve; denial/expiry is discoverable via status |

These extend the current product stories rather than creating a separate chatbot project. The lifecycle/error cases belong in acceptance now; polished geographical browsing comes later.

## “All in Finland” is two coverage problems

**User clarification:** nationwide directory/discovery and honest simulation come first; arbitrary kitchens producing usable purchasing plans come later. Both remain destinations. National exploration can therefore advance independently of production purchasing readiness, provided the UI never conflates them.

The present venue source contains 3,560 named venues in Helsinki/Espoo/Vantaa, with structured menus for 15, and explicitly says they are **not known Valio customers** ([venues:5](../research/venues.md#L5), [36](../research/venues.md#L36)). Public central kitchens/care/catering are incompletely represented ([21](../research/venues.md#L21)). Do not promote more points on a map into nationwide purchasing support.

Track separately:

1. **Discovery coverage:** source-observed venues, geography, segment, observation date, duplicates, menu and data completeness.
2. **Operational readiness:** connected/authorized kitchens, supported dishes/SKUs, verified units, contract/delivery schedule, policy configured, scenario/shadow/live mode and proven task success.

Use distinct entities for public venue/location, kitchen operating unit, parent organization/chain and purchasing account. A national map/list must expose readiness filters—discovered, profiled, menu parsed, shadow-ready, transaction-ready, active—plus region/municipality/segment and uncertain-data indicators. Selecting a place opens its profile and evidence; it must not imply it has an authorized agent.

**Recommended affordance:** map + synchronized accessible list for regional discovery; table/queue for operational action. Default regional summary reports both denominators (“X observed venues, Y connected kitchens”), freshness and segment gaps. The client remains a focused kitchen workspace, not a country map with an order button. Include Finnish and Swedish labels/search aliases, readable long names, remote delivery calendars and low-bandwidth/mobile use in later coverage gates. No claim that Helsinki quantities or calendar assumptions generalize to Levi, Åland or public procurement.

Menu enrichment can accept Exa-discovered URLs, Context-extracted text or Nemotron-read images through the same review object: page/crop, observed date, extracted dish/portion, uncertainty and correction history. A menu photo listing soup and portion grams does not establish ingredient quantities, yield or stock. The directory may truthfully say “menu extracted”; purchasing readiness requires a separate verified dish-to-ingredient mapping.

## Stages and proof, preserving the larger destination

| Stage | UX promise | Gate to advance |
|---|---|---|
| Ring 0, now | One chef can safely complete/revise a purchasing decision | Server-state projection and all critical states; edit-after-rescue journey; accessible approval; same state in kitchen and ops |
| Hackathon expansion | Nationwide exploration/simulation footprint + three representative transaction profiles + useful Operations | Imported coverage denominator and region/segment gaps visible; simulation labelled; operator drill-down; confirmed/unconfirmed/shortfall distinct; external agent completed journey |
| Four-week hotel pilot | Repeatable task, not a rehearsed event | Own menu/stock onboarding, delivery/mandate setup, shadow/live distinction, recovery/escalation, measured edits/time and override reasons; use PRODUCT pilot targets as targets |
| Operational coverage | Turn discovered venues into connected, usable heterogeneous kitchens | Coverage/readiness dashboard; duplicate/source review; role-aware onboarding; verified delivery and SKU coverage by segment |
| Nationwide operations | Thousands of kitchens remain understandable and governable | Queue ownership/SLA, bulk review with per-case exceptions, aggregate-to-line drilldown, verified schedules, multilingual access and long-tail coverage audits |

Do not build every navigation destination this weekend. Scaffold the objects and route contracts, then implement a complete journey per stage. Work is “good” when users can tell what happened, make the correct next decision and recover when it does not work—not when every pillar has a screen.

## Executor priorities

1. **Kitchen + core (1–2 h incremental):** server-derived action/coverage model; critical state fixtures/screens; correct post-approval commit and unknown labels. This complements, not duplicates, round-three transaction fixes.
2. **Kitchen (1–2 h):** mobile candidate cards and accessible review/confirm alternative; preserve the incumbent neutral/ticket-strip visual language.
3. **Ops (1–2 h for the first useful slice):** ticket → exact plan drill-down, actionable empty/error state and one urgent-case queue; keep current board as presentation mode.
4. **Lead/product (30–45 min):** surface/role matrix, consistent state/copy dictionary, route/read-model seams for coverage and stewardship. Put canonical design context where the skill launcher can be configured to find it; don't create a second divergent PRODUCT merely to satisfy tooling.

Do not score design quality numerically from source alone. The next visual pass should inspect phone and desktop, real-server pending/granted/partial/failed states, and keyboard/assistive activation. Parent may supply that evidence separately.
