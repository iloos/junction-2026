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
