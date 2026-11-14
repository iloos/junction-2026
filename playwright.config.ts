import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		// The preview reads the worktree's .env: never let a test server reach the real database or models.
		env: { DATABASE_URL: '', LLM_PROVIDER: 'fixture' }
	},
	testMatch: '**/*.e2e.{ts,js}'
});
