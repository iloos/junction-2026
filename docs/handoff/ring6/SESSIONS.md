# Ring 6 sessions: five lanes and the lead (Sat 22:30 → Sun 06:00)

_Lead, Sat 14 Nov 22:30. Replaces the seven-session table in [RESTART](RESTART.md) (read RESTART for the north star, foundations and the full queue; this page says who does what tonight and in what order). Freeze Sun 06:00, submission Sun 10:00. Prod runs a9f06ee; main (8e86190) is ahead and is deployed first._

## Roster (message by name)
Lead **junc26-52** · S1 Core **junc26-73** · S2 Kitchen **junc26-c6** · S3 Conversation **junc26-a1** · S4 Ops/deploy **junc26-d5** · S5 Evals/story **junc26-fb**. S6 Basket canvas **(GPT session, user-run)**: worktree `scratch/worktrees/basket-canvas`, branch `lane/basket-canvas`; owns only `src/routes/canvas/**` and `src/lib/canvas/**`; reads state through the existing projections and changes it only through the existing tools; not linked from the nav until the lead merges it after the hero journey is green. Deploys need the user's OK in S4's own session; the lead never deploys on S4's behalf.

## Added at 23:00: one flow (D23) and room mode (D24)
The user wants one coherent flow from asking to managing items, in chat or on the page, and an IRL demo where everyone runs their own store while Ops shows the orders arriving. Read [DECISIONS D23, D24](../../DECISIONS.md). The priorities below already include them:
- **S1** adds `create_kitchen` (copy the nearest seed profile under a new name and owner, in the room) after R12-04, before strict/best-try; best try is the default for soft asks, hard rules stay strict.
- **S2** makes the row primitive the one line control used in the dock cards too; the picker offers "Join the room as your own store".
- **S3** folds /request into the conversation (same transcript and cards full-width) and removes every "nothing matched" dead end.
- **S4** builds the room view on Ops (all stores, live orders, presenter shortage, a QR to join) before the sankey.
- **S5** adds a room journey to the playtest: three browsers, three stores, orders visible on Ops.

## The hero journey (user, 23:40): words → a costed, rule-checked plan the chef can act on
The user's call: moment 2 is the wow, because it shows the whole machine working. Acceptance, on prod at 1440 and 390, chat or /request: "a no-meat dinner for 120 with a peach dessert" → menu card → "plan it" → every ingredient has a real Valio product with a price or an honest label → **every held line sits in exactly one decision the chef can approve in the dock or on the page** → approve → ordered, receipt, the order shows on Ops. Owners: S3 drives it end to end; S1 fixes core (decision groups for every held line, produce and dairy diet facts); S2 makes the plan readable on the Kitchen; S4 shows it arrive on Ops; S5's playtest m2 is the referee and runs it after every deploy. Nothing else in a lane outranks a hero-journey blocker.

## How every lane works tonight
- Start: `Use the lane skill. Your brief is docs/handoff/ring6/SESSIONS.md, section <Sx>; resume details in docs/lanes/<brief>.md.`
- First 5 min: in your worktree, `git fetch` is not needed (shared object store); bring your branch to main (`git merge --ff-only main` or the rebase named below), `pnpm i --frozen-lockfile`, `pnpm gate --only check,lint`.
- Dev and tests with `DATABASE_URL=` blank and `LLM_PROVIDER=fixture`; your own port. Never read `.env` values. Never touch the main checkout.
- Edit only your owned paths. Anything shared (contracts, `tools/handlers.ts`, `scope.ts`, layout, global CSS, `package.json`) goes under **Needs** in your Report and to the lead by message.
- Ship small: each item is a commit with its acceptance shown (test or screenshot at 1440 and 390 in `scratch/`). Send the lead a SHA when an item is green; don't hold a batch.
- UI rule (RESTART Foundations 3, binding once S2 lands DESIGN.md): one row primitive, numbers right-aligned in tabular figures, no truncated chips, no raw ids, one primary action per zone, VOCABULARY words.
- Report: one line per item in your brief's Report: `time · done · needs · SHA · ready yes/no`.

## Merge waves (lead)
| Wave | Lead merges by | Then |
|---|---|---|
| A | Sun 00:30 | full gate, push, S4 deploys + smoke |
| B | Sun 03:00 | same; S5 runs the playtest on prod; findings routed |
| C | Sun 05:00 | same; last features. 05:00–06:00 fixes only |
| Freeze | Sun 06:00 | tag `demo-good`, deploy the tag, no redeploy after 09:30 |

---

## S1 · Core and agent door (absorbs 8d + da)
**Worktree** `../junc26-lanes/core-db`, branch `lane/a-atp` (`git merge --ff-only main`), port 5172. **Briefs:** [core-db](../../lanes/core-db.md) (Next 1–11), [agent-door-v2](../../lanes/agent-door-v2.md).
**Owns:** `src/lib/core/**` (not contracts without the lead), `src/lib/server/services/**`, `src/lib/server/tools/*` except `handlers.ts`, `src/lib/server/mcp/**`, `src/routes/agents/**`.
1. **R12-02** cereal codes + one allergen-group table exported from core (core-db Next 1). Tell S2 the export name.
2. **R12-04** contention adds only the residual (Next 2). This feeds moment 1.
3. **Moment 1 backend: one shortage, every kitchen re-plans.** One call (scenario action, also a tool for Ops/agent) drops a product's Valio stock and re-plans every affected kitchen's open plan within its own mandate, returning per kitchen: changed lines, swaps, what its mandate allowed, what now waits for a person. Events on the bus so S2 and S4 can animate it. Acceptance: test with three seeded kitchens giving three different answers to the same shortage.
4. **`create_kitchen` for room mode (D24):** copy the nearest seeded profile into a new kitchen with the visitor's name for it, owned by that visitor, in the room workspace (mandate, usual order, history copied, never linked). A tool and a kitchen-api route. Acceptance: two visitors in ws-judges each create a store; each sees and acts only on their own; a shortage re-plans both.
5. **Strict or best-try** per order/line for diet, allergen, origin as a tool parameter, with an eval where best try returns a labelled near-miss (RESTART breadcrumbs).
6. **Parity test** (Foundations 2): a test listing every tool and the UI control that calls it; human-only tools (approve, pair, grant) exempt. Start with the list; S2/S3 fill the control names.
7. Every `place_order` line makes a need (Next 10); `revise_menu` pin by an agent sets `pinnedBy:'agent'`.
8. Then R11-04, R10-06, R10-08 in that order.

## S2 · Kitchen and basket: the home that shows the agent's work (absorbs 1f + c3)
**Worktree** `../junc26-lanes/kitchen`, branch `lane/c2-ui` (`git merge --ff-only main`, then `git merge lane/c3-basket`: keep 1f's rows and rules, put c3's tabs around them), port 5178. **Briefs:** [kitchen](../../lanes/kitchen.md), c3's `docs/lanes/c3.md` on lane/c3-basket.
**Owns:** `src/routes/(kitchen)/**`, `src/lib/ui/**`, `src/lib/kitchen/**`, `docs/design/DESIGN.md`.
1. **Land c3** (R12-05/06): establishment first via `join`, Basket tabs, NothingPlanned; header kitchen selector joins, never plans. 390 px pass. Send the SHA early: it's wave A.
2. **DESIGN.md + one row primitive** (≤45 min, Foundations 3): 8-pt scale, the grid row (time · chip · text · value, fixed tracks), tabular numbers, chip sizing to the longest content, one bill-style line component. Start from [kitchen-a mock](../../design/mocks/kitchen-a.html). Other lanes adopt it after wave A.
3. **Home = "your kitchen's week, handled"** (north star): top of the Kitchen is a ledger of what the agent did (re-planned, swapped, held, ordered, why), the few decisions it needs (one row, one primary action each), and what is coming (deliveries, recalls watched). The basket and lines open beneath. Acceptance: a first-time visitor at 1440 and 390 sees "an agent buys for this kitchen under rules" above the fold.
4. **Moment 1 on the page:** when S1's shortage event arrives, changed lines animate, the ledger gains the re-plan entry, numbers count. Until S1 lands, build against a recorded event.
5. **One line control everywhere (D23)** and **"Join the room as your own store"** on the picker (calls S1's `create_kitchen`; until it lands, build against a stub).
6. **Per-line control, nested** (RESTART): amount, swap (compare), remove, hold, approve this line, why; a dish opens to ingredient sub-lines with the same controls; bulk = selection over the same actions.
7. Seed findings from RESTART "full UI/UX pass" (truncated chips, "No stock info", Still-not-covered as a grouped table, rules not detached, rail rows, type size).
8. Dock approval status ("You approved N lines", `evals/ui/dock-sync.e2e.ts:28`) with S3: S2 owns the shell, S3 the message.

## S3 · Conversation: chat, /request, menus (absorbs B + E + 41)
**Worktree** `../junc26-lanes/request`, branch `lane/b2-request` (`git merge --ff-only main`), port 5185. **Briefs:** [request](../../lanes/request.md), [agent2](../../lanes/agent2.md), [menu-v2](../../lanes/menu-v2.md).
**Owns:** `src/lib/server/request/**`, `src/lib/server/agent/**`, `src/lib/server/chat/**`, `src/lib/server/menu/**`, `src/routes/request/**`, `src/routes/api/chat/**`, the ChatDock content (shell is S2's), `evals/chat`, `evals/menu`, `evals/paraphrase`.
1. **Shares in the reading (user's top prod failure):** "hi i want 500 pizzas no meat 50%" → 250 meat-free + 250 any; a dish noun with a count takes the dish path; an ambiguous reading proposes its likeliest interpretation as one-tap ("250 meat-free and 250 regular?"), never a dead end. Held-out: "300 burgers, a third vegan", "half the 80 lunches gluten-free", "200 pizzas 40% veggie". Both doors.
2. **Moment 2: words → costed plan, reasoning shown step by step.** "a no-meat dinner for 120 with a peach dessert" routes to brief → menu (D20 `menu` kind) → dishes → ingredients → products → priced, rule-checked basket; steps stream as they happen in the dock and on /request. Acceptance: chat-only e2e (event → menu card → "plan it" → plan with decisions in the dock → approve in the dock → order), agent2 Next 1.6.
3. Dock approval message (with S2), R12-10 trials, D21 trials for a bare "ok" with a stale offer.
4. **/request is the conversation full-width (D23):** the same transcript and cards as the dock, `?text=` prefill kept; no "nothing matched" dead end anywhere (likeliest reading as one tap; labelled near-misses for soft asks).
5. /request lookup as one-line rows + comparison table, using S2's line component once it lands.
6. D15 stage 2 (chat calls `submitRequest`; "50 eggs" the same on both doors), choice quality.
7. Photos in the dock only if `VISION_LIVE=1`; else the button is hidden.

## S4 · Ops and deploy: Valio's view (9c)
**Worktree** `../junc26-lanes/ops`, branch `lane/g17` (`git rebase main`; 40be576 is WIP R12-09), port 5176. **Brief:** [ops](../../lanes/ops.md).
**Owns:** `src/routes/ops/**`, `src/lib/server/bus/**`, `src/lib/server/demo/**`, `src/lib/server/obs/**`, `scripts/deploy/**`. **Only S4 deploys** (procedure in ops.md); the lead pushes main first.
1. **Now:** deploy main 8e86190 as soon as the lead says it's pushed (gate is running), warm, smoke. Report the smoke.
2. **R12-09** finish: Ops reads stored traces and the Sponsors summary.
3. **Room view (D24), first:** Ops for the room shows every store, orders arriving live, demand per day; a QR/link to join the room as your own store; a presenter shortage button that re-plans every store (S1's cascade).
4. **Moment 4, Valio's view:** header + KPI row; Demand across all kitchens per delivery day; what the usual orders predict; where stock runs short (forecast); sankey demand flow kitchens → products. Labelled simulated where it is.
5. **Moment 1 on Ops:** S1's shortage cascade as it happens (which kitchens, which dishes, swaps, held vs ordered). A presenter button that triggers it in the visitor's sandbox.
6. Ops follows a sandbox reset from another tab; fix the smoke selectors (Add to calendar, the bill at 390).
7. After every wave: deploy, warm, smoke, post the result to the lead.

## S5 · Evals, playtest and the story (91 + d0)
**Worktree** `../junc26-lanes/f-evals` (`git switch lane/f-evals && git merge --ff-only main`), port 5190. Site work in `../junc26-lanes/site` (lane/site). **Briefs:** [f-evals](../../lanes/f-evals.md), [site](../../lanes/site.md), RESTART "self-testing judge harness".
**Owns:** `evals/**` (not the lanes' own suites above), `src/lib/server/evals/**`, `scripts/merge-gate.mjs`, `.claude/skills/playtest/**`, `docs/CLAIMS.md`, `docs/BUGS.md`, `docs/PITCH.md`, `docs/SUBMISSION.md`, `site/**`.
1. **Playtest v1 (by wave A):** `evals/playtest/` Playwright journeys for the four north-star moments + the nine R12 journeys, at 1440 and 390, against local fixture or prod; saves screenshots, DOM text, transcript to `scratch/playtest/<run>/`. Then a judge pass (the `judge` skill) with the five rubrics from RESTART writing `FINDINGS.md` with owner (S1–S4) per finding. Keep it lean: one command, ~15 min.
2. Run it on prod after each wave deploy; send the lead the routed findings; diff against the previous run.
3. **Truth pass:** CLAIMS → SUBMISSION → PITCH against the deployed SHA; sponsor usage observed with a trace (V1). Decide-ready notes on Context.dev and Exa entries.
4. **Video plan:** a ≤2:00 shot list over the four moments, each a URL + clicks + expected screen, so the user can film right after the freeze. Plus the 6-slide deck outline.
5. Site: the user's notes (side layout, smaller text and middle component, hero wrap), re-record cases after wave B, deploy.
6. Public-repo scrub **checklist only** (PLAN "Public repo scrub"): find every secret and quote; the history rewrite is the user's call.

## Lead (this session, main checkout)
Merges per wave with the full gate; answers Needs; writes the domain shape (RESTART Foundations 1) into ARCHITECTURE §Tenancy; records D22 and the Verda call when the user answers; STATUS and PLAN at each wave; vision-check before the freeze; cleans merged worktrees.
