import { defineConfig } from '@playwright/test';

/**
 * The playtest: journeys at 1440 and 390 against KITCHEN_URL (prod or any deploy), or, when it is unset, a local
 * preview on port 5190 with DATABASE_URL blank and the fixture LLM (the worktree .env points at prod: never let the
 * local preview reach it). Run through `node evals/playtest/run.mjs`, which sets the run directory and writes RUN.md.
 */
const remote = Boolean(process.env.KITCHEN_URL);

export default defineConfig({
	testDir: '.',
	testMatch: '*.play.ts',
	reporter: 'line',
	workers: Number(process.env.PLAYTEST_WORKERS ?? (remote ? 2 : 4)),
	fullyParallel: true,
	retries: 0,
	use: { trace: 'off', screenshot: 'off' },
	projects: [
		{ name: 'd1440', use: { viewport: { width: 1440, height: 900 } } },
		{ name: 'm390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
	],
	webServer: remote
		? undefined
		: {
				command: 'npm run build && npm run preview -- --port 5190 --strictPort',
				port: 5190,
				cwd: '../..',
				timeout: 300_000,
				reuseExistingServer: true,
				env: { DATABASE_URL: '', LLM_PROVIDER: 'fixture' }
			}
});
