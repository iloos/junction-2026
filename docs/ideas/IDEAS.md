# Ideas

Decide by **Fri ~22:30**. Before then: diverge (each person brings 3), then score, then run a 30-min spike on the top 2 (does the data or API actually deliver the wow?), then commit.

## Scoring (1–5 each; weights reflect the jury and our principles)
| Criterion | Weight |
|---|---|
| Problem worth solving: a real user, a real pain | 3 |
| Wow in 30s, explains itself | 3 |
| Data richness / scale story (many data points) | 2 |
| Sponsor stack: load-bearing tools (Cala/Exa/Context.dev/Featherless/Modal/Verda) | 2 |
| Feasible thin slice by Sat 06:00 (cut-off 08:00) | 3 |

## Pre-event directions (concept only, no code). Themes we like: knowledge graphs over digital context, coaching, the agentic economy (MCP, tool ecosystems).

### A. Cala, Make Unicorns Real: "the hidden map of who backs whom"
3D/2D living graph of investors, rounds, companies and founders. Ask the agent "who could warm-intro me to X" or "which investors back founders like me", and the graph flies to the path, with each edge cited. Exa finds "companies like mine", Context.dev adds real logos and colours plus live site diffs ("they just launched pricing"). Modal batch-enriches 10k companies live. Exposed as MCP so a founder's own agent can call it. *Slush is next week, so the timing story writes itself.* Fits: graph KB, agentic ecosystem, data scale, 3–4 sponsors, judges who are VCs.

### B. MariaDB, Wikipedia Through Time: "knowledge has a history"
A timeline/graph of how a topic's claims changed across revisions. "What did we believe in 2015, and when did that flip?" Sourced answers. A many-data-points story (revisions × claims), and a temporal-KB pattern we care about (claims, evidence, supersedes). Needs MariaDB, which breaks the localStorage default; acceptable if this is the challenge.

### C. S-Pankki, Personal Economic Trainer: "a coach that sees patterns in your money"
A dense spending dashboard (thousands of transactions) plus a coaching agent that turns patterns into small experiments ("you spend 3× on Thursdays"). Coaching transfer. Risk: easy to look like every other finance dashboard. The wow must come from the coaching loop, not the charts.

### D. Valio Aimo, Trusted Trade Agents: "agents negotiate, humans stay in charge"
A visual marketplace where purchasing agents and supplier agents transact over MCP-style tools. The human sees every proposal as a reviewable op, with failure modes surfaced. Speaks directly to the RL judge ("why does the agent fail"). Agentic-economy transfer.

### E. Open, digital-context graph (Context.dev open challenge or Agentic AI track)
Turn a pile of meeting notes, emails and docs into a typed knowledge graph (closed node and edge kinds), plus an agent that answers with paths and pre-meeting coaching nudges. Use public datasets (QMSum, AMI) or synthetic corpora.

Novelty multipliers (new models, protocols, breakthroughs): see [SOTA.md](SOTA.md). Pick at most one per idea.

## Spike questions per idea
- Does the API/data return enough, fast enough? (≤2s, or can we pre-cache?)
- What's the single most surprising thing the data can show?
- Can we generate 10× synthetic data that looks real?

## Log
| Time | Idea | Score | Decision |
|---|---|---|---|
