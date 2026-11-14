# Scaffold recipe (Fri 13 Nov)

_History: the scaffold is done (commit 091725f, `adapter-node` instead of Vercel per D3). Current stack: [STACK.md](../../STACK.md)._

Remaining deps arrive with the contracts commit: zod, drizzle-orm, drizzle-kit, postgres, @electric-sql/pglite (+ pglite-pgvector), @google/genai, ai + @ai-sdk/openai-compatible, @modelcontextprotocol/server + client, zod-openapi, context.dev, exa-js, bits-ui, d3, @lucide/svelte. The historical recipe below is kept for reference only.

```powershell
# in the repo root (it already has docs/ and CLAUDE.md, so scaffold into a temp dir, then move the files up)
pnpm dlx sv@0.17.1 create scratch/app --template minimal --types ts   # 0.17.1 = last sv that scaffolds Kit 2 (1.x scaffolds Kit 3)
#   # add-ons: tailwindcss, prettier, eslint, vitest, playwright
# move scratch/app/* (incl. dotfiles) to the repo root, merge .gitignore, delete scratch/app
pnpm add -D @sveltejs/adapter-vercel@^6      # swap it into svelte.config.js (D0d)
# sanity check: pnpm list @sveltejs/kit  → 2.70.x
pnpm add bits-ui @lucide/svelte svelte-sonner runed mode-watcher zod dexie d3
pnpm add -D @types/d3
pnpm add ai @ai-sdk/svelte @ai-sdk/anthropic @ai-sdk/google @ai-sdk/openai-compatible
pnpm dlx shadcn-svelte@latest init            # optional, for boring components
# then deploy:  pnpm dlx vercel@latest --prod   (link the project, add env vars in the dashboard)
# as the idea needs it:
#   pnpm add @duckdb/duckdb-wasm  |  pnpm add @cosmos.gl/graph  |  pnpm add three 3d-force-graph  |  pnpm add embedding-atlas
#   pnpm add @modelcontextprotocol/sdk @modelcontextprotocol/ext-apps   (check peer versions)
# Modal (only if needed):  uv tool install modal; modal setup
```

First commit after scaffold: `.env.example`, ports with fixture adapters, `/api/agent` streaming a fixture, one route rendering generated data. Deploy it. Then branch out.
