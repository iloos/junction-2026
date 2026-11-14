import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '$env/dynamic/private';
import { DEMO_WORKSPACE, JUDGES_WORKSPACE } from '$lib/server/demo/workspaces';
import { signVisitor } from '$lib/server/demo/visitor-id';
import { POST as mint } from '../../../routes/pair/new/+server';
import {
	CODE_ALPHABET,
	CODE_LENGTH,
	MAX_GLOBAL_MISSES,
	MAX_MISSES,
	PAIR_TTL_MS,
	mintPairing,
	redeemCode,
	redeemToken,
	resetPairing
} from './pairing';

const WS = 'ws-j-0123456789abcdef01234567';

beforeEach(resetPairing);

describe('pairing (D17: only the human grants)', () => {
	it('mints for a visitor sandbox only: never the stage or the judges’ room', () => {
		expect(mintPairing(DEMO_WORKSPACE)).toBeNull();
		expect(mintPairing(JUDGES_WORKSPACE)).toBeNull();
		const p = mintPairing(WS)!;
		expect(p.code).toHaveLength(CODE_LENGTH);
		expect([...p.code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
		expect(p.code).not.toMatch(/[01OI]/);
	});

	it('the link and the code each work once, and only for 10 minutes', () => {
		const t0 = 1_000_000;
		const a = mintPairing(WS, t0)!;
		expect(redeemToken(a.token, t0 + 1)).toEqual({ ok: true, workspaceId: WS });
		expect(redeemToken(a.token, t0 + 2).ok).toBe(false);
		// Redeeming one way retires the other.
		expect(redeemCode(a.code, 'ip', t0 + 3).ok).toBe(false);
		const b = mintPairing(WS, t0)!;
		expect(redeemCode(b.code.toLowerCase().replace(/(.{3})/, '$1 '), 'ip2', t0 + 1)).toEqual({
			ok: true,
			workspaceId: WS
		});
		const c = mintPairing(WS, t0)!;
		expect(redeemToken(c.token, t0 + PAIR_TTL_MS + 1).ok).toBe(false);
	});

	it('a client that misses many times waits; others sharing the venue are not locked out', () => {
		const t0 = 2_000_000;
		const p = mintPairing(WS, t0)!;
		for (let i = 0; i < MAX_MISSES; i++) expect(redeemCode('ZZZZZZ', 'bad', t0 + i).ok).toBe(false);
		expect(redeemCode(p.code, 'bad', t0 + 100)).toMatchObject({ ok: false, reason: 'limited' });
		// Five typos by anyone never block the rest of the room.
		expect(redeemCode(p.code, 'good', t0 + 101).ok).toBe(true);
	});

	it('a flood of misses pauses typed codes for everyone, while the QR link still works', () => {
		const t0 = 3_000_000;
		const p = mintPairing(WS, t0)!;
		for (let i = 0; i < MAX_GLOBAL_MISSES; i++) redeemCode('ZZZZZZ', `ip-${i}`, t0 + 1);
		expect(redeemCode(p.code, 'fresh', t0 + 2)).toMatchObject({ ok: false, reason: 'paused' });
		expect(redeemToken(p.token, t0 + 3)).toEqual({ ok: true, workspaceId: WS });
		// The window passes; typed codes come back.
		const q = mintPairing(WS, t0 + PAIR_TTL_MS + 10)!;
		expect(redeemCode(q.code, 'fresh', t0 + PAIR_TTL_MS + 11).ok).toBe(true);
	});
});

describe('POST /pair/new', () => {
	const event = (headers: Record<string, string>, cookie?: string) =>
		({
			request: new Request('http://localhost/pair/new', { method: 'POST', headers }),
			url: new URL('http://localhost/pair/new'),
			cookies: { get: (n: string) => (n === 'mandate_visitor' ? cookie : undefined) }
		}) as never;
	// Signed with the same env the route reads, as the browser's cookie would be.
	const cookie = () => signVisitor(WS, env);

	it('refuses a key, another origin, and a browser without its own sandbox', async () => {
		const withKey = await mint(
			event({ origin: 'http://localhost', authorization: 'Bearer jk_x' }, cookie())
		);
		expect(withKey.status).toBe(403);
		expect((await mint(event({ origin: 'https://evil.example' }, cookie()))).status).toBe(403);
		expect((await mint(event({}, cookie()))).status).toBe(403);
		expect((await mint(event({ origin: 'http://localhost' }))).status).toBe(403);
	});

	it('mints for the owning browser, uncached, with a one-time link on this origin', async () => {
		const r = await mint(event({ origin: 'http://localhost' }, cookie()));
		expect(r.status).toBe(200);
		expect(r.headers.get('cache-control')).toBe('no-store');
		const body = (await r.json()) as { code: string; link: string };
		expect(body.link).toMatch(/^http:\/\/localhost\/pair\/t\/[\w-]{20,}$/);
		expect(redeemCode(body.code, 'x').ok).toBe(true);
	});
});
