# Round 12 adversarial review: prompt

You are the adversarial reviewer for **Mandate**, a kitchen purchasing agent with an enforceable mandate on Valio Aimo's catalogue (Junction 2026). Rounds 9–11 found real defects in purchasing transitions, requirement propagation, command identity and recovery. This round has a wider brief: **does the full app work end to end as a product, what is still missing against the target shape, and where is it flawed?** Be concrete, reproduce what you claim, and rank by what a chef or Valio would actually hit.

## Ground rules
- **Review only.** No source edits, commits, branch switches or pushes. Don't change production data except inside your own visitor sandbox, which the app creates per browser. No paid provider calls beyond what the app itself makes under its caps. Don't read `.env` values.
- **Pin your evidence.** Record the source SHA you read (`git rev-parse HEAD` on `main`) and the deployed SHA (`https://app.mandate.kitchen/healthz`). When they differ, say which claims rest on which. Separate source reading, local runs (PGlite fixture, `DATABASE_URL=` blank, `LLM_PROVIDER=fixture`) and production observation.
- **Probes over opinions.** Each finding needs a reproduction: a URL plus steps, a test you wrote under `scratch/round12/` (gitignored), or a file:line with the exact input. A passing probe that reproduces a defect is an observation, not a regression; say so.
- **Read first:** `CLAUDE.md`, `docs/DECISIONS.md` (especially D13–D20), `docs/handoff/ring4/USER-DIRECTIVES.md` (the user's steers with owners and states), `docs/review/ROUND11-ADVERSARIAL.md`, `docs/CLAIMS.md`, `docs/concept/ARCHITECTURE.md`, and the lane briefs in `docs/lanes/*.md` (each ends with a checkpoint: done, open, risks).

## The target shape (what "working" means)
1. **One gate, one vocabulary.** Every state change goes through `applyOps` and `serveTool`. Hard constraints use one requirement vocabulary and one evaluator, `meets()` over `facets()` (D16). Every entry makes a need that carries what was asked, lines are bound to their need's amount, and there is one command identity, `commandKey` (D18).
2. **Intent, not phrases (D20).** Words are read into a general shape: what, how much (exact | range | max_available | for_people | unknown), constraints, when. Each kind is handled once. The `request.reading` judge checks the reading against the words. A stronger model re-reads unsure cases.
3. **Chat and canvas as one surface (D15, staged).** The Kitchen is a basket across every source: event, usual order, request, chat, outside agents. The agent sits in a right rail with decisions on top. Decisions show once, synced both ways, with the affected lines highlighted. Only a person approves (D13). Every turn ends in words, never on a silent step.
4. **Establishments and memory (D14).** Seven seeded kitchens, each with its own event, profile, rules and simulated order history. The usual order is detected per kitchen and becomes a plan only when the chef confirms it.
5. **Outside agents (D17).** MCP and REST get the same guarantees. Links point to things; only the human grants. Absolute links, pairing, and refusals that name the failing requirement.
6. **Observability.** Persisted traces with a request id end to end, structured logs, a per-sponsor summary.

## What to exercise, end to end (on production where possible, else local)
Walk each journey as a first-time visitor at 1440 and 390, then attack it.
1. **Kitchen as basket.** Switch through all seven kitchens: does each show its own event and basket? Plan, review a decision (the rail, then the highlighted lines), approve, order. Check what the receipt says against what was bought. Leave a decision held and come back.
2. **Request page.** Exact amounts, ml/cl/g, joined units ("250ml"), multipacks ("6x1l"), unknown units, brands and variants ("Arla whole milk"), "all your X", "for 80 people", a dish with a count ("10000 bolognese pasta, half beef, half mixed"). Then the ready-made vs from-raw choice, editing a step in place, the delivery-date control and cut-offs, an over-limit request, and a pack request with a hard requirement ("4 packs lactose-free milk").
3. **Chat (the agent dock).** The same asks in chat, follow-ups ("what", "where do we stand?", answering a chip), cancellation mid-turn, a new task versus the page's plan, and approving from the dock. Look for silent turns, raw ids (`pl-run-`, `ws-j-`, ISO dates), stale task headers, and chips that do nothing.
4. **Diet and requirements.** Vegetarian or vegan dishes whose product is out (the meatball trap), lactose-free, gluten-free, products with no allergen record, and substitutes that break a requirement. Do the marks (G/L/M/VEG/VE), the gate and the agent's answers ever disagree?
5. **Usual order and history.** The panel per kitchen and day, the window control, rhythm overrides, joined/dropped, "Plan this order" going through the normal gate, and the "simulated history" labelling.
6. **Product card.** The quantity token, the card, the verified public listing and photo (barcode match only), and honest gaps.
7. **Operations (Valio's side).** Orders stages, Demand per delivery day, refusal causes (never "out of stock" for a kitchen rule), "through the rules" counts, the traces summary, and performance at 10× demo size.
8. **Outside agent.** Connect over MCP with a judge key from `/agents`. Plan an event, propose and revise a menu, place an order, hit a requirement refusal and follow its `next`, try to approve (it must be refused), try a hidden tool, and follow the absolute review link as the human.
9. **Public site** (mandate.kitchen): the landing chain, the case cards, /how, /story and /proof. Check every number and claim against CLAIMS and the deployed app.

## What to look for
- **Broken or missing journeys:** places where the product shape stops (a dead end, a step that needs an unexplained manual nudge, a feature that exists only behind a flag or on a branch).
- **Safety and authority:** any path where an agent or an entry buys something not asked for, more than asked, in breach of a hard requirement, after cancellation, twice, or without the approval the mandate requires.
- **Truthfulness:** UI, chat, receipts, Ops, site and CLAIMS saying something the state doesn't support (stock certainty, "confirmed", causes, counts, photos).
- **Coherence:** the same concept computed or worded differently across surfaces (due times, product names, money, diet marks, stages, origin).
- **Overfitting:** phrase-specific branches, word lists grown per bug report, prompt examples mirroring tests. Write held-out paraphrases and report the generalisation gap.
- **UX and affordance (five-second rule):** unreadable or crowded screens, controls that look clickable but aren't, hidden primary actions, mobile reachability, unhelpful empty states.
- **Operations:** failure and recovery (supplier outage, stream gaps, reconnects, a reset in another tab), observability gaps (a call with no trace, a log line without a request id), cost and spend caps.
- **Round 10/11 disposition:** for every open and closed case, is it truly fixed on the deployed build, and does its regression test assert the right thing?

## Deliverables
1. `docs/review/ROUND12-ADVERSARIAL.md`, in the Round 11 format:
   - a header with the source SHA, deployed SHA, dates and limits;
   - **findings ranked P0/P1/P2**, each with an id (R12-nn), the concrete failure, the file:line or URL, the reproduction, an **owner** from the lane briefs, and **acceptance criteria** phrased as invariants, not patches;
   - a **gap table against the target shape** above: each of the six points marked working / partial / missing, with evidence;
   - the **R10/R11 disposition table**;
   - a **journey table**: each of the nine journeys marked pass / partial / fail at 1440 and 390, with the first breaking step.
2. `docs/handoff/review-adversarial-r12.md`: a one-page handoff with release priorities by owner, the next batch, evidence and limits, and integration guidance, as in Round 11.
3. Probes and screenshots under `scratch/round12/`, with a README listing the commands and results.

Leave both docs uncommitted for the lead. Prefer fewer, well-evidenced findings over many speculative ones, and say plainly where you could not verify something.
