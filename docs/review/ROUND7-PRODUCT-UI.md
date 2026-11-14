Method: dual-agent (A: `/root/ui_design`; B: `/root/ui_evidence`).

# Round 7: the chef's task and the human decision

**Verdict:** This feels like a real kitchen purchasing tool. Its explanations are stronger than its support for the human's remaining choice and interrupted work. The largest UI improvement is completing a decision on the correct recoverable plan, with its consequences beside the action. A new visual language or more charts will not accomplish that by itself.

Reviewed on 14 November at [the deployed app](https://widely-many-scorpion.eur-1.aiven.app). Assessment A used a fresh visitor at 932 × 950 window size; B independently used approximately 1600 × 865 content and explicit 390 × 760 responsive mode. Native UI work was sequenced to avoid sharing an input surface; assessments remained independent. A finished before the parent received B's detector findings. The deployed build's SHA was not independently established, so browser observations and source inspection are separate evidence.

S = <=1 hour; M = 1–3 hours; L = larger/integration-heavy. Source paths below are repository-relative. Full evidence: [A](../../scratch/round7/ui-a/assessment-a.md), [B](../../scratch/round7/ui-b/assessment-b.md).

## 1. R7-06 · P1 · A real pending purchase cannot be recovered through its queue link

**Observed live by A:** Select the butter example on Request → resolve two cases to 40 kg → reach a pending **€298.64** purchase → Operations → “Confirm, edit or swap.” The link opens the Christmas buffet, with an explicit warning that the requested plan differs. Returning to Request produces a blank composer. The backend plan exists; its usable human entry point has disappeared.

**Source:** `src/routes/ops/cases.ts:170` routes every plan to `/`; `server/kitchen/live.ts:112` finds only the seeded event plan; `KitchenScreen.svelte:53` treats plan identity as focus/warning context rather than selecting that plan. Request result state starts null (`request/+page.svelte:80`), and its server loader supplies no pending plan (`request/+page.server.ts:7`).

**Why it matters:** The judge's natural next move is to navigate away, follow an approval link or reload. A signed sandbox and durable SQL records do not make that journey recoverable. This also prevents the outside-agent handoff from being a general purchasing door.

**Recommendation — M, C/B/G:** One canonical plan/task URL must load that exact record, including a direct request, after reload. Ops and MCP approval links must use it. If the record cannot be shown, offer a recovery action to the real request instead of displaying another purchase. A minimal plan-specific review page is acceptable before a larger task shell.

**Acceptance:** Create butter → copy link → new tab in the same visitor session → approve exact butter terms → commit → reload → same receipt; the Christmas plan never replaces it. Then repeat with a second visitor and an external-agent-created plan.

Evidence: [wrong destination](../../scratch/round7/ui-a/wrong-plan-destination.png), [empty return](../../scratch/round7/ui-a/request-return-empty.png), [pending butter](../../scratch/round7/ui-a/request-plan.png).

## 2. R7-07 · P1 · The safety decision lacks the evidence required to make it

**Observed live by both:** “New product · Allergen change” groups **seven ingredients from two different preparations** under one hold-to-sign-off action. The card says “The allergens change,” without naming the dishes or actual before/after allergens. Product names and sales quantities alone do not establish the consequences. Labor and preparation assumptions live in a distant rescue panel.

**Source:** `ApprovalPanel.svelte:231` renders the reason-group explanation and lines; `ui/reasons.ts:46` supplies generic copy. Make-in-house caveats are in `RescuePanel.svelte:292`. Current grouping is an improvement over approving fourteen lines individually, but a shared reason is not always a shared decision.

**Recommendation — S–M, C + A:** Keep batching for routine new SKUs. For preparation changes, use a decision card per dish/strategy with exact terms, named allergen differences or missing evidence, the AND ingredient group, labor/equipment assumption, supply gaps and consequence of declining. Let the server grant exactly that group's line IDs. A hold gesture can remain, but the informed choice comes first.

**Buys:** A chef can actually evaluate “make this casserole here” independently of “make these tarts.” This is stronger evidence for trusted autonomy than an animated approval hash.

Evidence: [approval card](../../scratch/round7/ui-a/approval.png). B separately confirmed that approving the routine seven lines leaves the sign-off group open and explicitly says “Approved by you, not ordered yet”: preserve that useful distinction.

## 3. R7-12 · P1 for the phone demo · Test the state after the first successful action

**Observed live by B:** The initial 390 px kitchen and approval groups fit. The sticky Review link successfully jumps to `/#approval`. After approving routine lines and committing **11 lines / €852.09**, the receipt, rules and activity section overflows horizontally. Native horizontal scrolling reveals the clipped right-side values while losing left labels. Mobile Ops also clips workspace/run text and a metric.

**Source candidates:** `ApprovalPanel.svelte:473` receipt content, including a nonwrapping key at `:499`; Ops has its own layout rules. The screenshot establishes overflow; it does not prove a single CSS cause or a measured scrollWidth. Request's idle mobile form fit; mobile Agents was not tested.

**Recommendation — S, C/G:** Fix intrinsic widths in the receipt/key/table containers, allow diagnostic strings to wrap or use a contained scroller, and recheck the whole postcommit page. Capture initial, approved, partially committed and error states at 390 px. Keep diagnostics in the System drawer; a product user does not need the idempotency key inline.

Evidence: [postcommit left](../../scratch/round7/ui-b/kitchen-mobile-postcommit.png), [after horizontal scroll](../../scratch/round7/ui-b/kitchen-mobile-postcommit-horizontal.png), [Ops phone](../../scratch/round7/ui-b/ops-mobile.png).

## 4. R7-13 · P2 · The rescue table invites a choice the chef cannot make

**Observed by A and confirmed in source:** The ham view lists four alternatives with trade-offs, but there is no “use this candidate” action. `RescuePanel.svelte:9` accepts `rescue`, `grams` and `onfit`, with no selection callback. The workaround is changing global ranking presets and accepting whichever candidate wins.

**Why it matters:** A chef may know which preparation guests expect, which oven is free or which product staff can handle. A comparison view that permits only accepting the top result misses the human's most valuable contribution.

**Recommendation — M, C/A:** Let a viable row preview “Use this for this dish,” showing quantity, money, supply and approval changes, then apply it through the same strategy operation. Fix R7-02 first: adding selection atop the current stacking behavior would increase excess purchasing. Keep model-negative options explicitly assessed/held, not silently eligible.

**Buys:** Human correction beyond yes/no, without turning the screen into a webshop.

## 5. R7-14 · P2 · Count decisions and remaining needs, not every historical symptom

**Observed:** Kitchen says 14 approval lines; the card says two decisions; Ops lists separate ingredient cases and retains original outages. After B's successful partial commit, Ops still shows three “can't be ordered” products alongside seven sign-off lines, although substitutes have been proposed. `ops/cases.ts:63` retains blocked tone for an original with a substitute, and `:97` creates cases per held line.

**Recommendation — S–M, G/C:** The header should say what still needs a human and what service demand is unresolved. Group original shortage + chosen strategy + ingredient dependencies as one case, with a precise next action. A case can remain awaiting approval or supplier confirmation, but must close when its need is satisfied; a historical original SKU should not independently stay urgent. Derive these decisions from the shared plan projection and show line counts secondarily.

**Buys:** An operator can distinguish seven ingredients from seven separate problems. This confirms the internal Ops trust finding with an observed successful partial purchase; it is not a request for a bigger incident-management product.

## What to preserve, and how to show the system

Two strengths stood out. The butter case question exposes **8, 20 or 40 kg**, with conversion and cost before purchase; that is useful purchasing intelligence. The app visibly distinguishes cached data, scenario inputs, simulated orders and unknown supply. B observed a receipt explicitly saying **8 confirmed by the simulated supplier, 3 awaiting supplier**. Keep those labels and distinctions during the redesign.

I agree with the internal task-first shell and compact decision cards. I disagree with treating a shared type scale, a new shell and multiple d3 views as one prerequisite package. Fix the working journey incrementally. On desktop the approval is already a right-hand aside; the statement that it is always buried at the bottom is stale. On mobile its sticky jump already works. Put effort into evidence at the action and recoverable state.

For the System layer, prioritize one inspectable chain:

`buyer requirement → affected need → selected strategy → exact approved terms → committed receipt → remaining gap`

Use the existing Why drawer and coverage partition. A seal is useful only if it visibly breaks for R7-03's material supply change. A demand waterfall is useful only after R7-04's ingredient arithmetic and dependency propagation are correct. **Stop the funnel, gate sankey and extra run graphs until those two conditions hold.** Keep one live explanation, with source time and clickable evidence, rather than a second dashboard of mechanics.

## Design assessment and detector limits

Assessment A's heuristic score is **21/40**, a directional expert judgment, not a user study:

| Heuristic | /4 | Heuristic | /4 |
|---|---:|---|---:|
| System status | 3 | Match to kitchen work | 2 |
| User control | 2 | Consistency | 2 |
| Error prevention | 3 | Recognition over recall | 2 |
| Efficiency | 2 | Minimalism | 2 |
| Recovery | 1 | Help | 2 |

The detector found **two `side-tab` warnings**, both semantic status borders in `ops/+page.svelte:773` and `:870`; these are contextual false positives as usability findings. Expanded kitchen scan: **zero findings**. Neither result establishes accessibility. No contrast, keyboard-completion or screen-reader audit is claimed.

Run notes: target slug `src-routes-kitchen-page-svelte`; no ignore list; independent A/B assessments; browser host unavailable, native Chrome fallback; mutable overlay injection unavailable, so no overlay or live server was started. Review-owned Incognito/DevTools windows were closed and disappearance verified. Valid screenshots and detector output remain under scratch; the one invalid capture was discarded. Persistence is limited to the user's requested review/scratch locations.

Questions for the team:

1. Can the approver decline one make-in-house strategy without declining a different dish sharing its reason?
2. What is the canonical recoverable URL for a direct request or an outside-agent plan?
3. Which one human correction should the judge be able to make without changing the entire kitchen's policy?
4. Will the final phone rehearsal include a partial order and reload, not just the initial screen?

Questions skipped in chat: the requested deliverable is an outside-review report; these are handoff questions, not prerequisites for completing it.
