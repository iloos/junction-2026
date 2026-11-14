import { defineConfig } from '@playwright/test';

/**
 * The UI regression checks against a deployed app, with no local server: the root config's webServer builds and
 * previews the worktree, which would read the worktree .env (the prod DATABASE_URL). Use:
 *   KITCHEN_URL=https://<app> npx playwright test -c evals/ui/pw-prod.config.ts
 */
export default defineConfig({
	testDir: '.',
	testMatch: '*.e2e.ts',
	reporter: 'line'
});
