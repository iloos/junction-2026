# DECISIONS

`D#` · choice · why · what would reopen it. Append only.

### D0 · SvelteKit 2.70, scaffolded with `sv@0.17.1`, not Kit 3 — 13 Nov
Kit 3.0 shipped 1 Oct 2026 (six weeks ago), and `sv` ≥1.0 scaffolds it by default. We stay on Kit 2 because the coding agents' training knowledge and our own experience are Kit 2. On Kit 3 every agent would be guessing at changes, which is costly with parallel lanes in auto mode. Kit 2.70.4 is still maintained, and its peers (Svelte 5.57, Vite 8) are the same versions, so we lose nothing we'd use. Pair it with `adapter-vercel@^6` (7.x requires Kit 3). Reopen if: a library we need requires Kit 3.

### D0b · IndexedDB (Dexie) for datasets, localStorage for prefs, both behind StoragePort — 13 Nov
"Lots of data points" exceeds localStorage's ~5 MB, and having no server DB keeps the overhead low. Reopen if: the challenge needs state shared across users (then use a tiny hosted SQLite behind the same port), or it's the MariaDB challenge.

### D0c · d3 for maths and 2D; one optional 3D hero view behind a 1h spike — 13 Nov
3D impresses but costs readability and time. Reopen if: the spike shows 50k nodes smooth *and* 3D reveals structure 2D can't.

### D0d · Deploy on Vercel (`adapter-vercel`); fallback Fly (`adapter-node`) — 13 Nov
Least ceremony for SvelteKit: git push deploys, streaming responses work, preview URLs per branch. `fly` CLI is already installed as the fallback. Deploy the *empty scaffold* at 19:30 so deploy problems surface before anything matters. Reopen if: we need long-running jobs over 5 min (move them to Modal, not off Vercel), or Hostinger offers a prize for hosting there.

### D0e · LLM behind one port with four adapters plus a fixture — 13 Nov
`@ai-sdk/anthropic`, `@ai-sdk/google`, and `@ai-sdk/openai-compatible` (Featherless, Verda), plus fixture. Lets us pick the best model per task and show sponsor use without rewiring. Reopen if: the `ai` SDK fights a needed feature (then call the raw SDK inside the same adapter).

### D1 · First going plan: Valio Aimo "trusted trade agents" with a live immune system (Mandate) — 13 Nov ~21:30
Main challenge Valio Aimo, with Gemini API, Nemotron, Modal, Verda and Context.dev stacked as load-bearing parts ([concept/CONCEPT.md](concept/CONCEPT.md)). Why: the biggest software-only main prize. Its rubric (end-to-end 30, autonomy and controls 20, robustness 15, openness 15) rewards the gate, mandate and provenance design we already have. Every side prize gets a central role, and the swarm plus a judge's own agent gives the peer-review "no way" moment. Beat: finance slice (crowded, mobile-first scoring) and Wikipedia through time (original, but smaller prizes and needs a MariaDB server). Reopen if: Valio's mock API is too thin (spike), or a better idea scores higher in `idea-pick` before lanes fan out.

### D2 · Team name `j(x)`, ASCII fallback `jx` — 13 Nov
Solo team, so `j` can be all three at once: Junction, the person, and the function that turns the unknown challenge x into a demo. It reads as `f(x)` at a glance, and the pitch closes on `x = <challenge>` → `j(x) = <product>`. Reopen if: the platform refuses brackets (use `jx`) or the name is already taken.

### D3 · One container on Aiven; data in Aiven Postgres — 13 Nov ~23:00
The app ships as one container (`adapter-node` + Dockerfile), so the host is a config change. Primary host: Aiven Runtime (needs enabling by Aiven, in #aiven). Fallback: a Verda CPU VM. Emergency: Vercel. Data lives in Aiven Postgres in a Finnish region: orders, pending approvals, mandates, learned rules, the op log as JSONB, pgvector for the novelty check, and LISTEN/NOTIFY to stream ops to the live dashboard. Local dev uses Docker Postgres or PGlite as the fixture adapter. Browser storage keeps only UI preferences (replaces D0b for this concept). Why: outside agents, the swarm and the phone approval view all share state, so it has to live on a server. Vercel's function time limits clash with long dashboard streams and MCP sessions, and it isn't a sponsor; Aiven is (€1k best-use prize, mentors on site, EU). MariaDB was considered for its system-versioned tables, but its prize is Wikipedia-only, it would need self-hosting, and our op log already gives history. Reopen if: Runtime isn't enabled by Sat 10:00 (go to the Verda VM), or Aiven Postgres latency hurts the swarm.
