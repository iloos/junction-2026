import { defineConfig } from '@playwright/test';

/** The visitor integration gate only, against GATE_URL (no web server of its own; see serve-fixture.sh). */
export default defineConfig({
	testDir: '../../src',
	testMatch: '**/visitor-gate.e2e.ts',
	reporter: 'line'
});
