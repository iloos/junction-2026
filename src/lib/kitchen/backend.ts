/**
 * Snapshot and demo commands for one mode. Live: the server assembles the snapshot from the real plan
 * (/kitchen-api/snapshot, a read) and owns the demo commands (/kitchen-api/scenario). Fixture: the in-browser
 * stand-in, only for the explicit offline demonstration.
 */
import { ToolError, Unreachable, livePost, type ApiMode } from './api';
import type { PresetId } from './fixture-plan';
import * as fx from './fixture-server';
import type { FixtureSnapshot } from './fixture-server';

export type Snapshot = FixtureSnapshot;
export type MaybeStarted = Snapshot | { started: false; kitchenId: string };

export async function snapshot(mode: ApiMode): Promise<MaybeStarted> {
	if (mode === 'fixture') return fx.snapshot();
	let res: Response;
	try {
		res = await fetch('/kitchen-api/snapshot');
	} catch (e) {
		throw new Unreachable({
			code: 'PROVIDER_UNAVAILABLE',
			message: `server unreachable: ${e instanceof Error ? e.message : String(e)}`,
			retryable: true
		});
	}
	const body = (await res.json().catch(() => null)) as MaybeStarted | { message?: string } | null;
	if (res.ok && body && ('plan' in body || 'started' in body)) return body as MaybeStarted;
	throw new ToolError({
		code: 'PROVIDER_UNAVAILABLE',
		message: `snapshot failed (HTTP ${res.status})${body && 'message' in body && body.message ? `: ${body.message}` : ''}`,
		retryable: true
	});
}

const scenario = (action: string, value?: unknown) =>
	livePost<MaybeStarted>('/kitchen-api/scenario', { action, value });

export async function start(mode: ApiMode) {
	if (mode === 'live') await scenario('start');
}

export async function setPreset(mode: ApiMode, preset: PresetId) {
	if (mode === 'live') await scenario('preset', preset);
	else await fx.setPreset(preset);
}

export async function setKitchen(mode: ApiMode, kitchenId: string) {
	if (mode === 'live') await scenario('kitchen', kitchenId);
	else await fx.setKitchen(kitchenId);
}

export async function setContention(mode: ApiMode, on: boolean) {
	if (mode === 'live') await scenario('contention', on);
	else await fx.setContention(on);
}

export async function reset(mode: ApiMode) {
	if (mode === 'live') await scenario('reset');
	else await fx.reset();
}
