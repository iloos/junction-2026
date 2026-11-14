/**
 * Snapshot and demo controls for the current mode. Live: the server assembles the snapshot from the real plan
 * (/kitchen-api/snapshot) and owns the demo controls (/kitchen-api/scenario). Fixture: the in-browser stand-in.
 */
import { apiMode, livePost, useFixture } from './api';
import type { PresetId } from './fixture-plan';
import * as fx from './fixture-server';
import type { FixtureSnapshot } from './fixture-server';

export type Snapshot = FixtureSnapshot;

export async function snapshot(): Promise<Snapshot> {
	if (apiMode() === 'live') {
		try {
			const res = await fetch('/kitchen-api/snapshot');
			if (res.ok) return (await res.json()) as Snapshot;
			throw new Error(`HTTP ${res.status}`);
		} catch (e) {
			// Server unreachable or failing: keep the demo alive offline, visibly labelled.
			console.warn('[kitchen] live snapshot failed, using the offline fixture:', e);
			useFixture();
		}
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
