# Round 7 review prompt (outside reviewer, fresh session)

_Paste everything below the line into a fresh session with a strong model and high reasoning. It is written for that reviewer, not for the team._

---

You are reviewing **Mandate**, a hackathon project at Junction 2026 (Espoo), built by one person orchestrating several AI coding sessions over about 40 hours. Final submission is **Sunday 15 Nov 10:00 (Helsinki)**, and the team's own feature freeze is **Sunday 06:00**. It is now **Saturday afternoon, 14 Nov**. The team is about to start "Ring 2", a major upgrade of the product, its UI and its use of sponsor services. Your review will be folded into that work, so it is most useful now.

## What Mandate is
A purchasing agent for professional kitchens, built on **Valio Aimo's** real product catalogue (17.5k products) and its API. This is the main challenge, "Trusted Trade Agents". The idea: a kitchen delegates purchasing to an agent under an **enforceable mandate**.
- The agent acts alone within caps and rules.
- It proposes or asks for sign-off on anything else.
- Any approval binds to the exact terms (plan version + terms hash), and any change voids it.
- No double orders, enforced by idempotency on Postgres.
- Every state change goes through one function with an op log and provenance.
- The same gate serves the web UI, a REST API and MCP, so an outside agent can work through it too but can never approve.

The hero scenario is a Christmas buffet for 140 at a hotel kitchen, with real outages in Valio's data. The agent rescues them with substitutes or make-in-house recipes, ranked with known supply first. Other flows:
- a direct request (Valio's own milk example) on `/request`;
- an open request ("5-course dinner for 50") that becomes brief questions, then a menu proposal, then a plan;
- an operations control room (`/ops`);
- an `/agents` page that gives each visitor a judge key for MCP.

Sponsors the team pursues: **Valio** (main), **Google Gemini** (Decisions API for calibrated scoring, Flash-Lite for parsing, planning and menus), **Aiven** (Runtime hosting and Postgres with pgvector), **Context.dev** (a web monitor of the Finnish food authority's recall list) and **Exa** (web facts and outside options with citations).

## Where to look
The repository is in your working directory. Read in this order:
1. `CLAUDE.md`: rules of the project.
2. `docs/STATUS.md`: now.
3. `docs/DISPATCH.md`: live tracks; its bottom section is the Ring 2 plan.
4. `docs/DECISIONS.md`: D1–D10.
5. `docs/concept/`: CONCEPT, PRODUCT (personas, stories), ARCHITECTURE, SURFACES, VOCABULARY, GROWTH, SCORECARD.
6. `docs/PITCH.md`: claims and the evidence for each.
7. `docs/handoff/ring2/`: four internal design reviews done today (agent, sponsors, UI/UX, roadmap). Don't simply repeat them. Agree, disagree, or go further.

Then the code: `src/lib/core/` (pure domain: contracts, services, mandate, rank, demand), `src/lib/server/` (adapters, agent, store, tools, web, menu, request, demo), `src/routes/`, `evals/`, `scripts/`. History of past reviews: `docs/archive/`. The challenge briefs and judging criteria are in `docs/event/`.

You may run the app locally: `pnpm i`, then `DATABASE_URL= LLM_PROVIDER=fixture pnpm dev`. That uses an in-memory Postgres (PGlite) and fixture models; never point it at the real database. `pnpm gate` runs the full check suite. Playwright is installed if you want screenshots. The deployed app is https://widely-many-scorpion.eur-1.aiven.app. Treat it as shared: browse and plan in your own sandbox, but don't load-test it.

**Guardrails:**
- Never read values in `.env` files.
- Don't change application code or git state.
- Write only your review files (below) and anything under `scratch/`.

## What we want from you
A critical, independent review. **Explore; don't just audit a checklist.** We would rather hear one deep, surprising, well-argued point than twenty shallow ones. Take the perspectives you think matter. Some that matter to us:
- **The product and its users.** Would a real exec chef, purchasing manager, approver or supplier-side operator actually use this, trust it, and get value from it? What is the strongest version of this product, and how far is it from that? Where does it pretend?
- **The final shape.** Is the target in DISPATCH Ring 2 the right one? What would you cut, merge or reframe? What is missing that a judge or a real customer would expect?
- **Agent design.** Mandate, gate, tools, MCP, planner, review mechanism, the planned in-app chat. What is genuinely good agent architecture here, what is theatre, and what would make the agent meaningfully more capable without weakening the guarantees?
- **Use of the sponsors' products.** Are Valio, Gemini, Aiven, Context.dev and Exa used where they add real value and in a way a judge can see? Are there cleaner or more powerful ways to use them? Where are we faking or overclaiming?
- **UI/UX and affordance.** Hierarchy, flow, density, mobile, vocabulary, trust signals. How to show the system underneath (we plan d3 visualisations and a "System layer") so it explains rather than decorates.
- **Code and architecture quality.** Coherence, duplication, seams, correctness risks, test and eval honesty, failure modes, security of the public sandbox and keys, performance under a crowd of judges.
- **Demo and pitch risk.** What breaks first when a judge pokes at it? Which claims in PITCH.md would you challenge?

Be adversarial where it helps: try to break invariants (double orders, approving through MCP, voided approvals still committing, cross-visitor leaks, a judge's odd request). Be generous where something is genuinely good, but briefly. Back claims with evidence: file:line, a command you ran and its output, a screenshot path, a URL you visited. Separate what you **verified** from what you **infer**.

Prioritise for the time left: about 14 working hours before the freeze, with 5 AI coding sessions plus helpers. For each recommendation, say how big it is (S/M/L) and what it buys. Flag anything that should **stop**.

## Output
Write your review to `docs/review/ROUND7-<TOPIC>.md`. Use one file, or several if you split by perspective, e.g. `ROUND7-PRODUCT.md`, `ROUND7-AGENT.md`, `ROUND7-UI.md`, `ROUND7-SPONSORS.md`, `ROUND7-CODE.md`. Each file starts with a short verdict, then ranked findings (evidence, why it matters, recommendation, size), then open questions for the team. Keep each file readable in about 10 minutes. End with a one-page summary file, `ROUND7-SUMMARY.md`: your top 10 across everything, and the 3 things you would do first.
