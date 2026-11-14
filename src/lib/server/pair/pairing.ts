/**
 * Device pairing (D17: links point; only the human grants). The browser that owns a sandbox opens it on another
 * device by a QR code (a one-time link) or a short typed code. Neither ever appears in a tool result: they are minted
 * only for a request carrying that browser's own visitor cookie, never for a key, and live only in this process.
 *
 * Single use, 10 minutes. Codes use an unambiguous alphabet (no 0/O/1/I). Typed attempts are limited per client:
 * a few misses and that client waits. Visitor sandboxes only: the stage and the judges' room never pair.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { isVisitorWorkspace } from '$lib/server/demo/visitor-id';

export const PAIR_TTL_MS = 10 * 60_000;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
/** Typed misses a client may make before it waits out the window. */
export const MAX_MISSES = 5;
/** Codes one sandbox may have outstanding; minting another retires the oldest. */
const MAX_PER_WORKSPACE = 3;

interface Pairing {
	workspaceId: string;
	token: string;
	code: string;
	expiresAt: number;
}

interface PairState {
	byToken: Map<string, Pairing>;
	byCode: Map<string, Pairing>;
	misses: Map<string, number[]>;
}

const g = globalThis as typeof globalThis & { __mandatePairing?: PairState };
const state = (): PairState =>
	(g.__mandatePairing ??= { byToken: new Map(), byCode: new Map(), misses: new Map() });

function sweep(now: number) {
	const s = state();
	for (const [t, p] of s.byToken)
		if (p.expiresAt <= now) {
			s.byToken.delete(t);
			s.byCode.delete(p.code);
		}
	for (const [who, ts] of s.misses) {
		const kept = ts.filter((t) => now - t < PAIR_TTL_MS);
		if (kept.length) s.misses.set(who, kept);
		else s.misses.delete(who);
	}
}

function retire(p: Pairing) {
	const s = state();
	s.byToken.delete(p.token);
	s.byCode.delete(p.code);
}

export function newCode(): string {
	let c = '';
	for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
	return c;
}

/** "ab c-d e f" → "ABCDEF"; letters people confuse read as the alphabet's own (O→0 is not in it, so O stays a miss). */
export const normaliseCode = (typed: string) => typed.toUpperCase().replace(/[\s-]/g, '');

/** A one-time pairing for a visitor sandbox, or null for any other workspace (the stage, the judges' room). */
export function mintPairing(
	workspaceId: string,
	now = Date.now()
): { token: string; code: string; expiresAt: number } | null {
	if (!isVisitorWorkspace(workspaceId)) return null;
	sweep(now);
	const s = state();
	const mine = [...s.byToken.values()]
		.filter((p) => p.workspaceId === workspaceId)
		.sort((a, b) => a.expiresAt - b.expiresAt);
	while (mine.length >= MAX_PER_WORKSPACE) retire(mine.shift()!);
	let code = newCode();
	while (s.byCode.has(code)) code = newCode();
	const p: Pairing = {
		workspaceId,
		token: randomBytes(24).toString('base64url'),
		code,
		expiresAt: now + PAIR_TTL_MS
	};
	s.byToken.set(p.token, p);
	s.byCode.set(p.code, p);
	return { token: p.token, code: p.code, expiresAt: p.expiresAt };
}

export type Redeemed =
	| { ok: true; workspaceId: string }
	| { ok: false; reason: 'unknown' | 'limited'; retryInMs?: number };

/** Redeem by the QR link's token: single use. */
export function redeemToken(token: string, now = Date.now()): Redeemed {
	sweep(now);
	const p = state().byToken.get(token);
	if (!p) return { ok: false, reason: 'unknown' };
	retire(p);
	return { ok: true, workspaceId: p.workspaceId };
}

/** Redeem by a typed code: single use, and `who` (the client) is limited to MAX_MISSES misses per window. */
export function redeemCode(typed: string, who: string, now = Date.now()): Redeemed {
	sweep(now);
	const s = state();
	const misses = s.misses.get(who) ?? [];
	if (misses.length >= MAX_MISSES)
		return { ok: false, reason: 'limited', retryInMs: misses[0] + PAIR_TTL_MS - now };
	const p = s.byCode.get(normaliseCode(typed));
	if (!p) {
		s.misses.set(who, [...misses, now]);
		return { ok: false, reason: 'unknown' };
	}
	retire(p);
	return { ok: true, workspaceId: p.workspaceId };
}

/** Test seam. */
export const resetPairing = () => {
	delete g.__mandatePairing;
};
