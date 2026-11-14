# Prompt: adversarial full review (for an outside agent)

_Paste everything below the line into a fresh session (any provider) opened in this repo. It is self-contained._

---

You are an adversarial reviewer for a hackathon team. Your job is not to praise or polish. Find what will **lose** this hackathon and what would **win** it, then say so plainly, with reasons and concrete alternatives. Assume the team is smart and over-invested in its current idea; your value is in what they can't see.

## Situation (as of Sat 14 Nov 2026, ~00:30, Espoo)
- **Event:** Junction 2026, "European Tech Renaissance", ~2,000 builders, €100k prizes. Hacking started Fri 19:30. **Final submission Sun 10:00** (hard), team's own feature freeze **Sun 06:00**. Peer review Sun 10:30–14:00 is **face to face at tables**; each participant rates 5 projects; the top 5 pitch on stage (3 min + 3 min Q&A) to a 7-person grand jury (Supercell, AfterQuery, Founders House, Lifeline Ventures, Context.dev CTO, Verda CTO, Google DeepMind). Challenge prizes are judged separately by each partner on their own weighted criteria. One project may be submitted to several challenges.
- **Team:** effectively one builder (the lead) running many AI coding agents in parallel lanes (git worktrees), concept-first, then contracts, then lanes, with one lead merging.
- **Hard rules:** no code written before Fri 19:30; nothing related to an existing company; MIT and public at submission; no secrets in git.
- **Current state:** concept, research and setup are done; an app scaffold exists (SvelteKit 2, uncommitted); six foundation research notes are being written right now in `docs/foundations/`; ARCHITECTURE.md and contracts come next; lanes start Saturday morning. Roughly **30 hours of build time remain**.

## The current plan in one paragraph
**Mandate**: a kitchen-facing purchasing agent on top of Valio Aimo's wholesale catalogue (17.5k real products, a mock price/availability API). The agent turns a restaurant's menu × expected guests into the regular order, co-plans deviations (e.g. a hotel Christmas dinner for 140) as a diff against a normal week, handles anomalies (out of stock, cut-off times, pack sizes, recalls) with substitutes ranked by the kitchen's own priorities (price, carbon, Finnish origin, delivery reliability), and works in three tiers: act / propose / sign-off. Every decision is an op in a provenance log. It is exposed as an open MCP + OpenAPI interface (a judge's own Claude can connect and order), with a Valio-side control room showing hundreds of simulated kitchens' agents live (a swarm on Modal). Main challenge: Valio Aimo "Trusted Trade Agents" (€4k). Stacked tech prizes: Gemini API (€4k), Nemotron (RTX 5080), Modal ($2k), Verda ($10k credits), Aiven (€1k), Cloudinary, Context.dev, Gemma.

## Read in this order (index)
1. `CLAUDE.md`: rules, stack, doc system.
2. `docs/concept/CONCEPT.md`: the product (v2.1, including Valio's own info sheet rules: "not a chatbot", "query the APIs only when needed", required flow Request → Lookup → Order → Approval).
3. `docs/concept/SCORECARD.md`: every challenge criterion mapped to demo evidence.
4. `docs/DECISIONS.md`: D0–D3 (stack, deploy on Aiven, not Vercel).
5. `docs/event/CHALLENGES.md` and `docs/event/challenges/` (verbatim briefs with weighted criteria; `README.md` indexes all main and tech challenges), `docs/event/KICKOFF.md` (opening ceremony notes).
6. `docs/research/`: `horeca.md` (how kitchens and hotels really order), `menu-spike.md` (real menus via Context.dev), `agent-harness.md` (how to build with agents and how the product agent should work), `mcpcon.md` (agent failure stories, approval patterns).
7. `docs/foundations/`: per-service notes (some may still be in progress) and `README.md` (the phase plan and devops).
8. `docs/strategy/WINNING.md`, `docs/PLAN.md`, `docs/ORCHESTRATION.md`, `docs/STATUS.md`, `docs/LESSONS.md`.
9. `docs/ideas/IDEAS.md`, `docs/ideas/SOTA.md`: alternatives considered earlier.
10. Data shape: `data/valio/openapi.json` and the CSV headers in `data/valio/` (the product JSON is 87 MB: sample it with a script, never load it whole).

**Do not read** `.env`, `Misc/` or `scratch/` (credentials, private recordings, scratch work). **Do not modify any file** except your report.

## What to do
Explore freely and critically. Use the web if useful (past Junction winners, what wins agentic hackathons in 2026, the sponsors' own products). Answer these, ranked by how much each affects the chance of winning:

1. **Win or lose?** In one paragraph: if you were a judge at the Valio table, at a peer-review table, and on the grand jury, how would this project score, and why? Where is it generic, and where is it memorable?
2. **The idea:** is Valio Aimo the right main challenge for a solo builder with agents and 30 hours? Is there a sharper framing of the *same* work that wins more (a better hook, a better hero moment)? Name any idea that would beat it outright, and be honest if none does.
3. **Scope:** what is overbuilt for 30 hours? Cut it to what wins, and say which sponsors are load-bearing and which are decoration that will cost time and fool no judge.
4. **The demo:** the 2-minute table demo and the 3-minute stage pitch. Which moment makes a judge say "no way"? Is it real or faked, and will it survive bad Wi-Fi?
5. **Architecture and process:** will this shape (pure core, ports with fixtures, op log, MCP + OpenAPI from one service layer, parallel agent lanes, Aiven Postgres, Modal jobs) actually land in time? Find integration risks, single points of failure, and things that are too clever.
6. **Fit to criteria:** go through `SCORECARD.md`. Where will we lose points we think we have? What evidence is missing?
7. **Blind spots:** anything the team clearly hasn't considered (UX, data realism, Valio's existing products, legal or trust issues, the rule "not related to an existing company", demo logistics, the 2-minute video, peer-review dynamics).
8. **The three changes** you would make tonight that most increase the chance of winning, each with the cost in hours.

## Output
Write your report to `docs/review/REVIEW-<your-model-name>.md`:
- a **verdict** (≤5 lines);
- **ranked findings**, each with: severity (lose / weakens / polish), evidence (file and line, or source URL), and a concrete fix with an hours estimate;
- **ideas to win** (bold is fine; label them as ideas, separate from defects);
- what you would **not** change.

Be specific and blunt, and keep it under about 3 pages. Cite files and lines; no generic advice. If you're unsure, say so and say how to check.
