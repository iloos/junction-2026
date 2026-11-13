# Tooling: state and fixes (audited 13 Nov 2026)

## Do before 19:30 (≈20 min)
1. **Authenticate MCPs** in an interactive `claude` session with `/mcp`:
   - **context7**: it now returns 401 without auth (OAuth, or a `CONTEXT7_API_KEY` header). Your global rule depends on it.
   - **firecrawl-personal**: the keyless quota ran out today during research.
   - **playwright**: reconnect. It isn't broken; the failure is cached from a slow npx `@latest` start. To make it robust, pin it:
     `claude plugin disable playwright@claude-plugins-official` then `claude mcp add playwright -s user -- cmd /c npx -y @playwright/mcp@0.0.85`
   - hostinger, if you'll deploy there.
2. **Modal**: `uv tool install modal` → `modal setup`. Python: use `uv venv --python 3.12` (`python` on PATH is 3.10 while `pip` is 3.13).
3. **Exa MCP** (optional): `claude plugin install exa@claude-plugins-official`, or the hosted MCP.
4. **VS Code extensions:**
   `code --install-extension bradlc.vscode-tailwindcss ms-playwright.playwright dbaeumer.vscode-eslint esbenp.prettier-vscode vitest.explorer charliermarsh.ruff`
   Disable `vue.volar` for this workspace.
5. **impeccable**: `npx impeccable update` (4.8.2 → 4.9.0). Consider disabling its 30s Stop-hook "deep pass" during build hours; run `/impeccable` deliberately in the polish phase.
6. **`claude` CLI on PATH** (it's only bundled in VS Code now), so you can run parallel terminal sessions/worktrees: `irm https://claude.ai/install.ps1 | iex`.
7. **API keys** into `.env` (see `.env.example`): Anthropic, Gemini (AI Studio), Exa, Context.dev. Cala, Verda and Modal coupons come from the Junction platform.

## Nice to have (skip if short on time)
- `winget upgrade astral-sh.uv Git.Git GitHub.cli Microsoft.VisualStudioCode`
- pnpm 10.20 works fine; don't take a major upgrade mid-event.
- Housekeeping: remove the duplicate user-level `firecrawl` MCP entry (it's configured 4×); delete `~/.claude/settings.json.tmp.*` leftovers; move the GitHub MCP's plaintext token to OAuth.

## Current state
| Tool | Version | OK? |
|---|---|---|
| Claude Code | 2.1.323 (VS Code) | ✓ latest |
| node | 24.22.2 | ✓ |
| pnpm | 10.20.0 | ✓ (keep) |
| uv | 0.11.8 | update optional |
| gh | 2.83.2, logged in | ✓ |
| modal | — | ✗ install |
| docker | 28.5.1 | ✓ |
| fly | 0.4.121 | ✓ if used |
| Plugins | superpowers 7.0.2, frontend-design, code-review, firecrawl 2.0, context7, playwright, playground, skill-creator, typesafe | ✓ all current |
| Skills | impeccable, judge, review-loop, codebase-audit, cr, research-archive, planner | ✓ |

## Agent workflow during the event
- **Main session** (lead): plan, integrate, review. Keeps `docs/` true.
- **Parallel sessions in worktrees** for independent slices (viz / agent / data). Branches live for less than 2h; merge to `main`. Per the global rule: never junction `node_modules` into a worktree; run `pnpm i` inside it.
- **Subagents** for research (sponsor docs, data exploration) and review (`judge` for the idea decision, `vision-check` for claims vs. code).
- **Superpowers flow, compressed:** brainstorm → plan (in docs/PLAN.md, not a separate spec file) → subagent-driven execution for well-defined tasks → verification before claiming anything done.
- **Design:** `/impeccable` with PRODUCT.md/DESIGN.md once the idea is chosen; `frontend-design` for direction; Playwright screenshots to check the result.
