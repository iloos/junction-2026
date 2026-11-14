/**
 * Snapshot and demo controls for the current mode. Live: the server assembles the snapshot from the real plan
 * (/kitchen-api/snapshot) and owns the demo controls (/kitchen-api/scenario). Fixture: the in-browser stand-in.
 */
import { ToolError, apiMode, livePost, useFixture } from './api';
import type { PresetId } from './fixture-plan';
import * as fx from './fixture-server';
import type { FixtureSnapshot } from './fixture-server';

export type Snapshot = FixtureSnapshot;

/**
 * The server's snapshot. Only an unreachable server (offline demo) switches to the labelled fixture; a server
 * that answers with an error stays live and the error is shown, so fixture data never replaces server results.
 */
export async function snapshot(): Promise<Snapshot> {
	if (apiMode() === 'live') {
		let res: Response;
		try {
			res = await fetch('/kitchen-api/snapshot');
		} catch (e) {
			console.warn('[kitchen] server unreachable, using the offline fixture:', e);
			useFixture();
			return fx.snapshot();
		}
		const body = (await res.json().catch(() => null)) as Snapshot | { message?: string } | null;
		if (res.ok && body && 'plan' in body) return body;
		throw new ToolError({
			code: 'PROVIDER_UNAVAILABLE',
			message: `snapshot failed (HTTP ${res.status})${body && 'message' in body && body.message ? `: ${body.message}` : ''}`,
			retryable: true
		});
	}
	return fx.snapshot();
}

const scenario = (action: string, value?: unknown) =>
	livePost<Snapshot>('/kitchen-api/scenario', { action, value });

export async function setPreset(preset: PresetId) {
	if (apiMode() === 'live') await scenario('preset', preset);
	else await fx.setPreset(preset);
}

export async function setKitchen(kitchenId: string) {
	if (apiMode() === 'live') await scenario('kitchen', kitchenId);
	else await fx.setKitchen(kitchenId);
}

export async function setContention(on: boolean) {
	if (apiMode() === 'live') await scenario('contention', on);
	else await fx.setContention(on);
}

export async function reset() {
	if (apiMode() === 'live') await scenario('reset');
	else await fx.reset();
}
