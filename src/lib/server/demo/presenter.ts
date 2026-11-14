import type { Env } from '$lib/server/auth';

/**
 * Whether key-less presenter actions are open (the /ops run-agent and reset buttons, the stage workspace
 * for key-less surfaces): always in dev, and on the deployed app only with DEMO_RESET_OPEN=1. Otherwise
 * presenter actions need a key (POST /api/demo/reset, /api/agent/run) and key-less surfaces use ws-judges.
 */
export function presenterOpen(env: Env, dev: boolean): boolean {
	return dev || env.DEMO_RESET_OPEN === '1';
}
