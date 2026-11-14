/**
 * Call limits for outside agents (judge keys, MCP_KEYS, MANDATE_KEY_EXTERNAL_AGENT). The routine agent has its own
 * caps (8 steps, one run per workspace); an outside agent is a loop we don't run, so its key is metered here: writes
 * fill the database and `quote` can reach Valio. Sliding one-minute windows per actor, in this process.
 */
import { toolSchemas, type ToolName } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';

export interface KeyLimits {
	/** Every call. */
	calls: number;
	/** Calls that write (plan and order scopes). */
	writes: number;
	/** Live terms: `quote` reaches Valio for ids the cache does not hold. */
	quotes: number;
}

export const KEY_LIMITS_PER_MINUTE: KeyLimits = { calls: 120, writes: 30, quotes: 20 };
const WINDOW_MS = 60_000;

type Bucket = keyof KeyLimits;

const g = globalThis as typeof globalThis & { __mandateKeyCalls?: Map<string, number[]> };
const seen: Map<string, number[]> = (g.__mandateKeyCalls ??= new Map());

/**
 * Outside agents are metered; the chef, the routine agent and system jobs are not. Under vitest the evals drive the
 * external actor hundreds of times a minute, so the windows are off there and tested through `takeKeyCall`.
 */
export const isMetered = (ctx: CallContext, env = process.env) =>
	ctx.actor.kind === 'external_agent' && !env.VITEST;

function bucketsOf(name: ToolName): Bucket[] {
	const scope = toolSchemas[name].scope;
	const out: Bucket[] = ['calls'];
	if (scope === 'plan' || scope === 'order') out.push('writes');
	if (name === 'quote') out.push('quotes');
	return out;
}

/**
 * Count this call against the caller's windows. Returns the seconds to wait when a window is full (the call is
 * then not counted), or null when it may go ahead.
 */
export function takeKeyCall(
	ctx: CallContext,
	name: ToolName,
	now = Date.now(),
	limits: KeyLimits = KEY_LIMITS_PER_MINUTE
): { bucket: Bucket; retryAfter: number } | null {
	const buckets = bucketsOf(name);
	const lists = buckets.map((b) => {
		const id = `${ctx.actor.id}|${b}`;
		const kept = (seen.get(id) ?? []).filter((t) => now - t < WINDOW_MS);
		seen.set(id, kept);
		return { b, id, kept };
	});
	for (const { b, kept } of lists)
		if (kept.length >= limits[b])
			return { bucket: b, retryAfter: Math.max(1, Math.ceil((kept[0] + WINDOW_MS - now) / 1000)) };
	for (const { kept } of lists) kept.push(now);
	// Idle actors carry no information; keep the map small.
	if (seen.size > 2000)
		for (const [id, ts] of seen)
			if (!ts.length || now - ts[ts.length - 1] >= WINDOW_MS) seen.delete(id);
	return null;
}

/** Test seam: forget every window. */
export const resetKeyLimits = () => seen.clear();
