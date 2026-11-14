# Round 5: request meaning, agent context and API boundaries

Review of the working tree from `dc0f213` through `dd600e5`, with focused final rereads at `a7600f2` (main continued advancing during review). Evidence below names the actual source paths rather than treating earlier reviews as current behavior. No application edits, network calls, shared database access, `.env`, `Misc/` or scratch reads. Reproductions used pure functions with synthetic products, contexts and a fake LLM through local `tsx`; these are diagnostic probes, not new committed regression tests.

## Assessment

The agent boundary is materially stronger than a prompt listing tools. It now constructs a delegated principal, resolves a supported intent before planning, intersects tool permissions, checks kitchen resources, carries run expiry, and guards tool starts against cancellation and deadlines (`src/lib/server/agent/index.ts:41`, `:65`; `principal.ts:31`; `loop.ts:188`, `:232`). The model receives typed facts rather than arbitrary raw tool responses. These are useful foundations for a larger product.

The main remaining weakness is **preserving the user's meaning across separate paths**. Request entry has a physical-unit parser and converter; the routine agent has a different parser and interprets the number as sales units. Model-assisted parsing can erase a dietary constraint. Final outcomes infer supplier confirmation from committed plan state. These are concrete correctness issues, even when every tool call is authorized and schema-valid. Adding more tools or model context will not resolve them.

Deterministic workflows remain appropriate. The target should be one typed request/domain contract that either a deterministic workflow or an agent can operate on, with models used for bounded interpretation and choices where they add value.

## Current flow map

```text
Request UI / request API
  text + scenario today + kitchen + actor/workspace context
    -> parseRules + optional model interpretation
    -> ParsedRequest(items, physical units, four known constraint types, one date)
    -> catalogue search -> candidate ranking -> physical-to-sales conversion
    -> quote -> first pickable candidate per item
    -> place_order through the tool gate -> plan -> human approval / commit

Agent run
  initiating actor + delegated principal + authorized kitchens + scenario today
    -> bootstrapContext(current plan, supported seeded events)
    -> resolveIntent BEFORE planner
    -> intent tools intersect principal tools
    -> scripted planner OR model planner
    -> tool gate + resource checks + domain handlers
    -> bounded typed facts in step history
    -> final get_plan -> computeOutcome(plan state)

Web enrichment / outside discovery
  application query -> Exa structured search -> typed-looking content + grounding
  authority page -> Context.dev structured scrape -> runtime-validated recall notice
    -> findings / proposed alternatives / human decision, not supplier authority
```

Workspace routing and web findings isolation are covered by the separate Round 5 web review. The diagram describes transformations, not a claim that all entry points already preserve the same authority scope.

## Correctness findings and executor guidance

### P0: model parsing can silently remove an explicit product constraint

**Observed.** `fromLlmItem` constructs constraints solely from model output (`src/lib/server/request/parse.ts:326`, `:332`). `sameItem` compares quantity/unit and product, but not constraints or variant (`:360`). Successful model items replace rule items (`:399`, `:434`).

Pure probe: request `10 l lactose-free milk by 2026-12-10`, today `2026-12-07`; fake model returns milk, 10 l, the correct date, and `constraints: []`. The returned item has no lactose-free constraint, no item ambiguity and no request ambiguity. Candidate constraint filtering therefore has nothing to enforce. This is not an adversarial model requirement: an ordinary omission is enough.

**Fix:** preserve explicitly extracted constraints with source spans; disagreement must become a blocking clarification or conservatively retain the explicit requirement. Unknown constraints must remain unresolved requirements rather than disappearing through the known-key filter. Separate requirements from preferences and model suggestions. Do not silently treat unsupported allergy text as a supported dietary guarantee.

**Gate:** model omission, contradictory model output, Finnish/English synonyms, reordered items and unknown dietary restrictions must preserve every explicit requirement or visibly request clarification. Test the result passed to candidate filtering, not just parser JSON validity.

### P0: routine-agent ordering changes units and delivery dates

**Observed.** `resolveIntent` has its own numeric parser, removes unit words and `tomorrow`, and defaults non-ISO dates to today +2 (`src/lib/server/agent/intent.ts:21`, `:95`, `:125`). Its routine intent carries no physical unit. The scripted planner takes the first search result and submits the number with that product's sales unit (`loop.ts:418`, `:435`). The stronger request converter is bypassed.

Pure probe with today `2026-12-07`: `order 4 kg butter tomorrow for k-hotel` resolves to quantity 4 and `2026-12-09`. With a returned 500 g butter product sold as `ST`, the next scripted action orders **4 ST = 2 kg**, instead of 4 kg for `2026-12-08`. A model planner cannot recover original semantics reliably from a lossy intent contract.

**Fix:** route routine orders through the same typed request interpretation, candidate ranking and quantity conversion as request entry. Until that is integrated, explicitly support only sales-unit syntax and reject physical units/relative dates that this route cannot honor. Retain original text and parsed evidence for audit, but do not make the planner re-interpret it independently.

**Gate:** the same request through UI, API and agent produces the same requirements, delivery date, candidate set and rounded sales quantity. Cover decimal comma, thousands separator, kg/l/pcs/case, tomorrow/weekday/ISO and missing units. Assert domain inputs before commit.

### P1: committed is reported as confirmed, including awaiting-supplier supply

**Observed.** `computeOutcome` marks a need confirmed when its active lines are committed and returns fulfilled once none remain unconfirmed (`src/lib/server/agent/outcome.ts:57`, `:106`). Core commit deliberately distinguishes receipt `confirmed` from `awaitingSupplier` (`src/lib/core/services/orders.ts:456`, `:474`, `:508`).

A synthetic committed plan with a committed line and unknown availability returns `status: fulfilled`, a confirmed need and zero unconfirmed needs. The probe exercises the outcome function, not the full supplier path. The mismatch follows directly from the outcome's missing receipt input: it cannot distinguish a submitted Terminal order from confirmed supply.

**Fix:** define separate outcomes for request accepted, order committed, supplier confirmed and physical need covered. Derive supplier status and quantities from persisted order/receipt evidence; keep unknown supply explicit. Compare coverage quantity with the requested need, rather than equating any committed covering line with complete fulfillment.

**Gate:** committed-but-awaiting-supplier is never described as supply confirmed; partial quantities and partially committed baskets remain partial. Inspection may still be fulfilled once its read succeeds: that is a different intent.

### P1: ambiguity and partial item selection do not block a draft

**Observed.** `runRequest` asks first only when no items were parsed; ambiguities otherwise become events/warnings (`src/lib/server/request/run.ts:361`). It filters to items with a pick (`:381`) and sends those lines to `place_order` (`:413`). Thus a multi-item request can become a subset plan while unresolved items remain outside that plan's needs. This is a draft, not an automatic claim that the user approved it, but downstream plan-only outcomes cannot measure the original request's completeness.

**Fix:** persist a request envelope with stable item IDs and statuses: resolved, needs clarification, unavailable, omitted by user. Require an explicit partial-order choice when only a subset is orderable. Distinguish a harmless explanatory note from a blocking ambiguity. Tie plans and receipts back to the request item IDs.

**Gate:** three requested items with only two pickable candidates show all three through review, and commit cannot erase the unresolved third item from the request outcome.

### P1: one date parser cannot represent multiple requested deliveries

**Observed.** `parseRules` resolves one `findDate` and one global delivery date (`src/lib/server/request/parse.ts:270`, `:286`). Probe `10 l milk by Monday and 5 kg butter by Friday`, today Monday `2026-12-07`, returns both items but the global date is Monday `2026-12-14`; Friday is not represented as a second deadline. Another probe `10 l milk by 2026-02-31` returns that impossible date without ambiguity. ISO dates are accepted verbatim; numeric dates rely on JavaScript date validity, which normalizes some impossible calendar days (`request/dates.ts:77`, `:87`). Model date acceptance is regex plus lexical comparison (`parse.ts:408`).

**Fix:** use a shared strict calendar-date value; round-trip year/month/day validation. Detect multiple date expressions before selecting one. Either split into delivery groups or ask the user to choose; keep today's scenario clock and the Helsinki business calendar explicit. Preserve item/date attachment during bilingual parsing.

**Gate:** impossible dates, leap days, Monday-on-Monday, past dates, multiple item deadlines and Finnish numeric formats produce deliberate results rather than quiet normalization.

### P1: lookup quantity and authoritative order quantity diverge on lots

**Observed.** The request converter returns the raw quantity for a product sold by kg (`src/lib/server/request/convert.ts:356`), while lookup stock checking compares against that conversion (`lookup.ts:110`). Core ordering applies `toLot` (`src/lib/core/services/orders.ts:56`, `:179`).

Pure synthetic probe: KG product, lot step 10 kg, request 11.5 kg, stock 15 kg. Converter reports exact 11.5 kg with no warning, and lookup considers it pickable. Core lot rounding requires 20 kg, which is not available. The authoritative validator protects the eventual order, but the preview is inconsistent.

**Fix:** share one sizing result across candidate feasibility, quote, preview and order input: physical demand, sales quantity, lot rounding, overage and explanation. Reuse the existing pure demand rounding primitives where appropriate (`src/lib/core/demand/rounding.ts:35`), rather than maintaining independent sizing algorithms.

**Gate:** boundary quantities below/on/above lot steps and stock between raw and rounded demand agree in preview and authoritative validation.

### P1 at scale: bounded context silently excludes relevant plan lines

**Observed.** Facts use an array helper that slices at 40 (`src/lib/server/agent/facts.ts:14`, `:43`). Plan facts include the resulting lines/needs, without total counts, a truncated flag or pagination (`:66`). A pure probe with 41 lines and only line 41 unorderable returns 40 lines and no unorderable line. Quote facts also omit numeric stock and price validity while retaining availability kind (`:125`). The domain handler still validates; the planner lacks evidence to target all exceptions or explain some choices.

**Fix:** keep the bound, make loss explicit. Provide counts and exception summaries, then tools for page/filter retrieval and individual need detail. Prefer blocked/changed/remaining needs over the first 40 in storage order. Facts should carry the versions and decisive supply facts needed for the supported decision, without dumping whole raw responses.

**Gate:** a 10× demo plan with the only shortage beyond the first page is discovered, resolved or explicitly reported as uninspected. Total context remains bounded and records which evidence was omitted.

## Context selection and state management

`bootstrapContext` chooses the first uncommitted event plan, otherwise the highest plan version (`src/lib/server/agent/context.ts:34`, `:37`). Version is local to a plan, not global recency. Shortage and inspection intents use `currentPlan` even when the user names another authorized kitchen (`intent.ts:58`, `:85`, `:130`). This is a code-derived risk, not an executed multi-kitchen probe: a correctly authorized run can select the wrong authorized resource.

Use an explicit resource selector: kitchen → selected request/event → plan ID and expected version. When multiple plans fit, ask or show a selector. Session memory should record resource references and user-confirmed preferences, not silently turn a historical model summary into current authority. Rehydrate live state and versions through scoped reads before acting. Nationwide expansion needs this distinction before larger prompts or retrieval indexes.

## Model jobs, web APIs and budgets

The routing distinction is useful: request parsing, substitute fit and an optional model planner are different jobs. Keep their model choices, schemas, fallback labels, latency budgets and evals separate. The agent's eight-step cap and 600-output-token planner calls are real controls (`src/lib/server/agent/loop.ts:117`, `:517`); the run also stops waiting at cancellation/deadline. Do not repeat the old claim that it has no deadline guards.

Remaining gaps are end-to-end budgets and transport cancellation. The planner races a provider promise against the stop signal; the comment correctly says the underlying call may finish (`loop.ts:76`, `:490`). Pass cancellation to adapters that support it, reserve time for finalization, and count aggregate input/output tokens and external calls per job/run. Request lookup and web discovery need their own overall deadline, bounded concurrency and retry budget; a per-fetch timeout alone is not a user-operation deadline.

Local Exa and Context.dev skills were consulted for the request-shape review; no remote API compatibility was tested. Exa uses `/search`, structured output schema and grounding, while Context.dev uses structured scrape and monitor operations. The important asymmetry is validation: Exa accepts object-shaped `output.content` with an `as T` cast (`src/lib/server/web/exa.ts:96`), whereas recall extraction uses runtime schema validation (`web/contextdev.ts:69`, `:81`). Add runtime schemas, bounded list lengths and meaningful failure states to Exa outputs too. A structured-output schema sent to a provider is not a runtime guarantee at the application boundary.

The shared web HTTP cache defaults to infinite age (`src/lib/server/web/http.ts:107`); callers can request fresh reads. Exa discovery/facts should specify a freshness class rather than inheriting permanent reuse. Product identity facts, recall notices, supplier availability and discovery candidates have different lifetimes. Show fetched-at and evidence scope in reviews. A citation or GTIN match establishes a source relationship; it does not make an outside recipe a priced, deliverable, constraint-compliant substitute.

The HTTP client uses a per-attempt timeout (`web/http.ts:137`) and a retry policy. Add a flow signal/deadline and call budget propagated across search, extraction and any catalogue expansion. Log purpose, cache status, model/provider, tokens where available, latency, retry count and request/run IDs; omit secrets and unnecessary customer text.

## Suggested execution order and acceptance stories

1. **Preserve meaning before broadening entry points.** Fix lost constraints; unify routine-agent and request parsing/conversion; make blocking ambiguities and partial requests explicit. Story: a chef enters the same bilingual request in chat, the request box or an external agent and sees the same dated, rounded basket and unresolved requirements.
2. **Make outcomes faithful to supply.** Persist request-item coverage and derive confirmation from receipts. Story: a buyer can distinguish “submitted, awaiting supplier” from “confirmed,” without reading traces.
3. **Make context deliberate.** Explicit kitchen/plan selection, bounded exception-first facts with retrieval, strict dates and versions. Story: a group operator repairs a named kitchen's shortage in a 500-line plan without changing another site's plan or silently overlooking line 41.
4. **Make outside evidence operationally useful.** Runtime validation, freshness policies, call budgets, scoped findings and approval into catalogue-backed proposals. Story: an operator inspects a discovered substitute's evidence and unresolved identity/pack/delivery requirements before it becomes orderable.

These are contracts between product areas, not additional standalone features. They allow an internal operations dashboard, client-facing interface and outside-agent API to become three reliable views of one system rather than three implementations of purchasing semantics.
