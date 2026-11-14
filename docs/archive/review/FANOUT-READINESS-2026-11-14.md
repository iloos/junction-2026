# Fan-out readiness after the Ring 0 checkpoint

Review of main `ddf874c`, 14 November 2026. Read STATUS, PLAN, SYNTHESIS and its owner replies, orchestration, decisions, active lane handoffs and earlier proposal briefs; spot-checked current contracts and approval flow. Review only: no application changes, provider calls, tests or edits to lead-owned planning files.

**Concurrent T0 update:** contract edits appeared in the shared working tree during the final check. They are uncommitted draft work, not missing effort. The notes below distinguish the committed dispatch baseline from that draft; the lead's changes were left untouched.

## Verdict

The adopted [SYNTHESIS](../handoff/SYNTHESIS.md) is a useful execution direction: preserve meaning across paths, repair peer-review isolation, make the agent discoverable, and build one open-menu service behind both entry points. Keep those decisions and the larger product shape.

**Proceed with independent repairs and fixture work now. Gate integration-dependent implementation on a named contracts SHA and explicit ownership.** At this snapshot T0 is still proposed: current contracts do not yet contain `EventBrief`, `DishTemplate`, `FulfilmentView`, `WebExecutionContext` or per-line order authority. Worktrees have been created on `ddf874c`; that proves a starting point, not that those interfaces are frozen.

The principal risk is coordination rather than an unmanageable feature count: different documents still authorize incompatible work, A is the critical path for several other lanes, and several proposed contracts omit the transitions their consumers need.

## Findings to resolve before lanes implement shared behavior

### 1. High: there are several competing dispatch documents

[STATUS](../STATUS.md) says Ring 0 is stable and deployed. [PLAN](../PLAN.md)'s leading section still marks the request box, live Kitchen, deploy and other completed Ring 0 tracks unfinished. Its open-request and model-routing work is not organized as the adopted T0/A–G graph. SYNTHESIS itself still says its tracks are pending user re-scope; its introductory STATUS-staleness note predates the new STATUS.

The briefs also mix history and current authority: core-db's top report says tools are unimplemented, then its Handoff correctly says all slices are merged. Old proposal briefs still authorize a composer, embedding batch, approval page and Ops case work. These proposals are not all assigned or in the adopted schedule.

**Lead action:** put one short dispatch block at the top of PLAN and every active brief: authoritative synthesis revision, active scope, base/contracts SHA, owned paths, first deliverable, dependencies and acceptance command. Mark preceding task lists historical and unassigned proposals inactive. Incorporate §7 amendments directly into the track table: G has taken F27, E depends on A's fulfilment, and web work can partly start before T0. Nobody should need to reconcile three paragraphs to discover their job.

### 2. High: ownership still overlaps at the exact integration points

| Shared boundary | Current competing instructions | Explicit assignment needed |
|---|---|---|
| Catalogue search/candidates | A broadly owns catalogue adapters; B-retrieval also edits them | B owns search/candidates; A owns offers/scenario stock. Separate files or agree exact method hunks and merge order. |
| Tool registry/contracts | E owns `server/tools/**`; D needs new tools; T0 owns contracts | Lead owns registry/schema changes; E owns serving/presentation; D supplies web handlers. Identify the wiring commit and its owner. |
| Workspace/auth resolution | G changes session workspace; E needs runtime keys; Request/Kitchen have local workspace helpers | G owns the common resolver and token verifier, including named edits to those helpers; E consumes its interface. |
| Exact plan/recovery routes | G promises exact-plan routes and Request URL recovery, outside G's normal paths | G specifies scoped locator; Request owns its loader/recovery; Kitchen owns event-plan rendering; assign the standalone approval route. |
| Web-facing UI | D promises Why-drawer content and an Ops recall card, outside D's paths | D exposes typed evidence; C and G mount/render it, with fixtures and an integration check. |
| Evaluation assets | Core's old brief owns evals; E owns agent trials; F owns evals/scripts | Domain tests stay with implementations; F owns cross-path scenarios/harness and the merge gate. Name exceptions for existing agent trials. |

This does not require another redesign. Record these exceptions before concurrent edits start. In particular, do not give both A and B blanket permission to edit the same catalogue files.

### 3. High: A's 10–12-hour estimate makes whole-track dependencies impractical

The core owner's §7 estimate puts `FulfilmentView` late in A. C waits on it; E needs it for truthful outcomes; B waits on arbitrary-event handling. The current ordering could leave three lanes ready to integrate only late in the day. T0 compiling does not mean those implementations exist.

**Split A into mergeable contracts and vertical increments:**

1. A1: supply ordering, zero demand, scenario-date defaults and per-line audit authority, each with its own checks.
2. A2: shared physical sizing/direct Need plus fulfilment computation. Publish representative fixtures immediately, before implementing the service.
3. A3: cutoff/approval temporal validity, including clock-context integration with G. Do not leave a displayed-but-unenforced cutoff behind a UI-polish dependency.
4. A4: arbitrary event assembly consuming an already validated dish/ingredient proposal. B owns interpretation/model proposal; A owns deterministic demand/plan creation.

These are delivery boundaries, not a demand for four additional agents. Let C build against A2 fixtures, B build interpretation and questions against A4 fixtures, and E build discovery plus faithful fallback labels now. Merge the adapters only when the real contract passes the same fixture assertions. If A2 or A4 slips, other lanes should still deliver useful independent work.

### 4. High: subset approval is a state-machine change, not just an optional `lineIds`

Current `approve` makes a pending approval terminal in one decision, `get_plan` returns one approval, and `currentApproval` selects a single pending/granted record ([orders service](../../src/lib/core/services/orders.ts#L217)). Per-reason grants must answer: what remains pending, can groups be granted sequentially, what happens to an earlier grant when another group is denied, which grants cover a commit, and what does editing invalidate?

**Before adding subset grants:** specify one example with three groups and grant/deny/commit/edit transitions; test that no grant authorizes an unseen line. Per-line order authority also needs backward reads for historical orders and a policy for the existing top-level `authority` field.

If this contract cannot be completed promptly, use the synthesis's UI grouping fallback: review each reason group and then make one clearly described grant of the exact combined terms. Do not imply the user has separately authorized partial purchases unless the server supports that semantics.

### 5. High: the menu contract must preserve physical demand and evidence status

The ruling alternates between `plan_event{brief,dishes}` and `plan_event{brief}`. Decide which inputs the tool actually accepts and where generation happens. Pure core must not depend on `server/menu` or initiate a vendor call. A server orchestration handler can prepare a proposal, then call deterministic planning through the established ports/store boundary.

Minimal proposal contract: stable proposal/revision and item IDs; covers/date/budget/diet requirements; dishes with ingredient quantities **and units** per portion; edible/purchased basis and yield; source/estimate status; unresolved conversions/constraints; and explicit chef acceptance. Dish grams alone do not establish ingredient composition (D6). Do not model all ingredients as kg: liquids and pieces need deliberate conversion or an unresolved state.

Keep `proposed → chef-reviewed → planned` distinct. An accepted estimated menu is not automatically a verified recipe, safety fact or reusable authoritative KB entry. Store accepted estimates with their status; promotion requires evidence/review. Explicit requirements must survive model revisions, and inline answers must attach to stable IDs rather than array positions or potentially duplicate text.

**B's gate should be stronger than “held plan, no graham pie”:** all requested courses/covers appear; ingredient amounts reconcile; every unmapped ingredient remains visible; hard dietary uncertainty cannot be approved away; edits invalidate downstream sizing/approval; reload recovers the same proposal/plan. First prove one coherent arbitrary menu, then broaden supported inputs.

### 6. High: visitor identity and runtime agent credentials need one end-to-end contract

HMAC versus DB keys is still unresolved. Either can work; choose one owner and one format now. A cookie's workspace string is not authorization merely because an ID is unguessable. The server must verify the session assignment; runtime tokens must bind the workspace, actor/scopes and expiry. E should not implement a second minting/verification path. State deliberately whether a reset invalidates tokens or lets workspace-bound tokens resolve only the current run.

The same resolver must cover Kitchen, Request, Ops, event reads, web actions, agent bootstrap and approval links. Approval URLs locate a task; they do not grant human authority. Keep external-agent credentials approval-incapable. For an external MCP client, specify how its approval URL reaches the correct visitor session and what a different/empty-cookie browser sees.

**G/E integration gate:** browser A and browser B, an MCP client and a fresh approval-link browser. A's request, Ops, web findings and MCP use A's workspace; B cannot read/reset/approve it; A's reset changes only A; tampered cookie/token/URL parameters cannot choose another workspace. Thirty-visitor resource bounds are useful, but this journey must pass first.

### 7. Medium: web “self-healing” does not yet cover changed notices

`allSettled`, a drill namespace and list polling repair failed delivery and sibling handling. They do not fix existing-URL suppression: `newNoticeUrls` skips any already-known URL. Nor does a global finding becoming workspace-scoped ensure a recall applies to a fresh run or newly created plan.

A full source-document platform can stay deferred. Minimal acceptance still needs separate source version/digest and scoped application identity (workspace/run/target), plus retry state. Test an amended notice at the same URL, a new run and a drill followed by the real notice. A precautionary hold needs evidence and a defined resolution/review path, not an unexplained permanent blockage.

Also resolve a scope contradiction before exposing web tools: the old web brief proposes `lookup_facts` as `read` although it records enrichments and spends provider credits. Either make lookup read-only with an explicit apply command, or give it a capability whose description and permission policy include those effects. Fixture tests should exercise this distinction through the public tool gate.

### 8. Medium: evals need to be ready at the boundary, not after the features

F should write cross-path fixtures now: lost dietary constraint, kg/tomorrow fidelity, unequal-pack substitute, zero need, expired offer, awaiting supplier, missing recipe ingredient, two-workspace scope and exact-plan reload. Expected facts should be independent of a particular product search order; changing retrieval must not mean rewriting expected outcomes until they match the new first result.

Separate feature correctness from model trials. Three repeated live planner trials are useful diagnostics, not a reliability claim. Shared Postgres smoke is opt-in and should use a disposable test workspace/run, not reset the demo or run on every developer test. The deterministic checks remain the merge gate. Every UI integration still needs the repo's browser evidence.

## Proposed execution waves

| Wave | Start / deliver | Gate |
|---|---|---|
| Now | B: explicit-constraint/parser repairs; E: unit/date guard, context completeness; D: cache/schema/drill fixes; G: common visitor resolver and scope fixtures; F: regression cases | Independent commits with owned paths; do not invent T0 replacements. |
| Contract checkpoint | Lead publishes small T0 commits: identity/key context; intent/sizing/fulfilment; menu proposal; approval/audit semantics | Actual types, runtime schemas, valid/invalid examples and stored-record compatibility. Pin SHA in each lane. |
| Integration 1 | A1 + G + E discovery; truthful units/status fallbacks; exact request/approval recovery | Two browsers + external agent complete the milk flow in one isolated workspace; Ops opens that exact plan. |
| Integration 2 | A2/A3 + C coverage/Why + E outcomes | Physical quantities and confirmed/unknown supply agree everywhere; cutoff checks use the same scenario clock. |
| Integration 3 | B menu interpretation/retrieval + A4 deterministic assembly + D evidence UI | One arbitrary dinner reaches an editable, explained, safely held plan; every unresolved requirement remains visible. |
| Video checkpoint | Freeze a green deployable tag; decide Exa/Context.dev claims from observed journeys | Source evidence → precise affected plan → human action, with truthful live/replay labels. |

Do not require the whole platform to finish before a stable integration. Keep model-routing expansion, embeddings, composer and additional dashboard affordances behind the complete journeys above. This is sequencing to protect the bigger scope, not a recommendation to replace it with a chatbot.

## Immediate lead dispatch

1. Reconcile PLAN/STATUS/brief headers with SYNTHESIS and its §7 amendments; deactivate old proposals.
2. Publish path ownership and the identity/key + approval decisions before consumers implement them.
3. Give A's dependent lanes concrete fixtures and small merge milestones, rather than a 10–12-hour whole-track dependency.
4. Assign the approval route, exact-plan loading and web UI mounts explicitly: they currently fall between tracks.
5. Make the first shared milestone the isolated external-agent milk journey with exact-plan recovery; follow with consistent fulfilment and arbitrary-menu composition.

## Final spot-check of the in-progress T0 draft

These observations concern uncommitted files as they appeared during review; recheck the final contracts commit.

- **Fix before consumers implement it:** `FulfilmentView`'s comment currently defines `confirmed` as either a confirmed receipt **or an eligible line against known stock**. Those are different states, especially without reservations. Keep `orderableKnown`/planned coverage separate from `supplierConfirmed`; agent outcomes and Ops must not call an uncommitted order fulfilled. Define demand allocation so retries, partial receipts and alternative lines cannot double-count. Prefer an exact partition of required demand with excess recorded separately, rather than only the proposed `confirmed + awaitingSupplier + unresolved ≥ required` invariant.
- **Good additions to retain:** `PlanView.asOf/validUntil`, explicit physical/comparison measures, per-line authority with a documented old-order fallback, and planned-tool schemas that are not advertised until handlers exist. These address concrete handoffs from the review.
- **Tighten menu semantics:** `DishIngredient.gPerCover` permits `g | ml | pcs`; rename it to a neutral amount-per-cover field before users proliferate. Default `yield:1` must be labelled an assumption if not established. `DishTemplate.satisfies` cannot certify diets merely because model output claims it; distinguish proposed compatibility from verified constraint evidence. A chef editing an estimated number changes its provenance but does not establish an allergen fact.
- **Keep stable recovery identities:** the draft has dish IDs but no ingredient IDs or proposal/revision identity. Add them or specify where they live before inline answers and menu edits depend on array order. Validate that each ingredient has a resolvable query/product or an explicit unresolved state; do not silently drop it.

These are small contract corrections with large downstream consequences. Resolve them in T0 rather than teaching each lane a separate interpretation later.
