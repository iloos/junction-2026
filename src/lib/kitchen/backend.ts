/**
 * Snapshot and demo commands for one mode. Live: the server assembles the snapshot from the real plan
 * (/kitchen-api/snapshot, a read) and owns the demo commands (/kitchen-api/scenario). Fixture: the in-browser
 * stand-in, only for the explicit offline demonstration.
 */
import { ToolError, Unreachable, livePost, type ApiMode } from './api';
import type { PresetId } from './view-model';
import * as fx from './fixture-server';
import type { FixtureSnapshot } from './fixture-server';

export type Snapshot = FixtureSnapshot;
export type MaybeStarted = Snapshot | { started: false; kitchenId: string };

/** The current snapshot; with `planId`, opens that plan (an approval link) instead of the kitchen's event plan. */
export async function snapshot(mode: ApiMode, planId?: string): Promise<MaybeStarted> {
	if (mode === 'fixture') return fx.snapshot();
	let res: Response;
	try {
		res = await fetch(
			planId ? `/kitchen-api/snapshot?plan=${encodeURIComponent(planId)}` : '/kitchen-api/snapshot'
		);
	} catch (e) {
		throw new Unreachable({
			code: 'PROVIDER_UNAVAILABLE',
			message: `server unreachable: ${e instanceof Error ? e.message : String(e)}`,
			retryable: true
		});
	}
	const body = (await res.json().catch(() => null)) as
		| MaybeStarted
		| { message?: string; error?: { code: string; message: string; retryable: boolean } }
		| null;
	if (res.ok && body && ('plan' in body || 'started' in body)) return body as MaybeStarted;
	if (body && 'error' in body && body.error)
		throw new ToolError({ ...body.error, code: body.error.code as never });
	throw new ToolError({
		code: 'PROVIDER_UNAVAILABLE',
		message: `snapshot failed (HTTP ${res.status})${body && 'message' in body && body.message ? `: ${body.message}` : ''}`,
		retryable: true
	});
}

const scenario = (action: string, value?: unknown) =>
	livePost<MaybeStarted>('/kitchen-api/scenario', { action, value });

/**
 * Each live command answers with the new snapshot, so the caller uses it instead of a second GET.
 * Fixture commands return null: the caller reads the fixture snapshot.
 */
export type Answer = MaybeStarted | null;

export interface PlanProgress {
	planned: true;
	dishes: number;
	lines: number;
	outages: number;
}

/** Start, step 1: plan the event; answers with real counts for the progress label. */
export function planStep(): Promise<PlanProgress> {
	return livePost<PlanProgress>('/kitchen-api/scenario', { action: 'plan' });
}

/** Start, step 2: the kitchen agent proposes rescues; answers with the snapshot. */
export function rescueStep(): Promise<MaybeStarted> {
	return scenario('rescue');
}

export async function setPreset(mode: ApiMode, preset: PresetId): Promise<Answer> {
	if (mode === 'live') return scenario('preset', preset);
	await fx.setPreset(preset);
	return null;
}

export async function setKitchen(mode: ApiMode, kitchenId: string): Promise<Answer> {
	if (mode === 'live') return scenario('kitchen', kitchenId);
	await fx.setKitchen(kitchenId);
	return null;
}

export async function setContention(mode: ApiMode, on: boolean): Promise<Answer> {
	if (mode === 'live') return scenario('contention', on);
	await fx.setContention(on);
	return null;
}

export async function reset(mode: ApiMode): Promise<Answer> {
	if (mode === 'live') return scenario('reset');
	await fx.reset();
	return null;
}

/** Live: make the order follow the previewed rules (replace substitutes, re-quote, void the approval). */
export async function applyRules(mode: ApiMode): Promise<Answer> {
	return mode === 'live' ? scenario('apply') : null;
}
