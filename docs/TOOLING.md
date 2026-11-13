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

8. **Project permission allowlist for auto-mode lanes** (an agent can't install this itself; that's by design). Review the draft and copy it to `.claude/settings.json` in the repo: it allows pnpm/npx/git/uv/modal/Playwright, asks before push and worktree remove, and denies force-push, `reset --hard` and reading `.env`.

## Nice to have (skip if short on time)
- `winget upgrade astral-sh.uv Git.Git GitHub.cli Microsoft.VisualStudioCode`
- Keep pnpm 10.20; don't take a major upgrade mid-event.
- Housekeeping: remove the duplicate user-level `firecrawl` MCP entry; delete `~/.claude/settings.json.tmp.*`; move the GitHub MCP token to OAuth.
- Optional dev aids: `plannotator` (annotate agent plans before execution), `lot-map` (live map of tool calls and subagents).

## Agent workflow
See [ORCHESTRATION.md](ORCHESTRATION.md): concept first (brainstorming, research subagents, CONCEPT/ARCHITECTURE, contracts), then parallel lanes (`lane` / `integrate` skills). Design: `/impeccable` with PRODUCT.md/DESIGN.md in the polish phase; `frontend-design` for direction.
