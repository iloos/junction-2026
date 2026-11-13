# DECISIONS

`D#` · choice · why · what would reopen it. Append only.

### D0 · SvelteKit 3 as scaffolded by `sv` 1.3 — 13 Nov (replaces the earlier "Kit 2" note)
`sv create` now scaffolds `@sveltejs/kit ^3` / `adapter-auto ^8` / Vite 8. Pinning Kit 2 would fight the tool. Kit 3.2 is the third release and needs the same peers (Svelte ≥5.57, Vite 8) that already work for us. Check Kit 3 changes via context7 when something surprises us. Reopen if: Kit 3 breaks an adapter or a library in the first 30 min (fallback: `pnpm add -D @sveltejs/kit@^2.70 @sveltejs/adapter-vercel@^6`).

### D0b · IndexedDB (Dexie) for datasets, localStorage for prefs, both behind StoragePort — 13 Nov
"Lots of data points" exceeds localStorage's ~5 MB, and having no server DB keeps the overhead low. Reopen if: the challenge needs state shared across users (then use a tiny hosted SQLite behind the same port), or it's the MariaDB challenge.

### D0c · d3 for maths and 2D; one optional 3D hero view behind a 1h spike — 13 Nov
3D impresses but costs readability and time. Reopen if: the spike shows 50k nodes smooth *and* 3D reveals structure 2D can't.

### D0d · Deploy on Vercel (`adapter-vercel`); fallback Fly (`adapter-node`) — 13 Nov
Least ceremony for SvelteKit: git push deploys, streaming responses work, preview URLs per branch. `fly` CLI is already installed as the fallback. Deploy the *empty scaffold* at 19:30 so deploy problems surface before anything matters. Reopen if: we need long-running jobs over 5 min (move them to Modal, not off Vercel), or Hostinger offers a prize for hosting there.

### D0e · LLM behind one port with four adapters plus a fixture — 13 Nov
`@ai-sdk/anthropic`, `@ai-sdk/google`, and `@ai-sdk/openai-compatible` (Featherless, Verda), plus fixture. Lets us pick the best model per task and show sponsor use without rewiring. Reopen if: the `ai` SDK fights a needed feature (then call the raw SDK inside the same adapter).
