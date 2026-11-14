import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { bodyLimit, handle, IMAGE_BODY, SMALL_BODY } from './hooks.server';

const run = (path: string, length: number, headers: Record<string, string> = {}) =>
	handle({
		event: {
			url: new URL(`http://x${path}`),
			request: new Request(`http://x${path}`, {
				method: 'POST',
				headers: { 'content-length': String(length), ...headers }
			})
		} as unknown as RequestEvent,
		resolve: async () => new Response('ok')
	});

describe('request body limits', () => {
	it('allows 8 MB only where images arrive', () => {
		expect(bodyLimit('/api/tools/read_image')).toBe(IMAGE_BODY);
		expect(bodyLimit('/mcp')).toBe(IMAGE_BODY);
		expect(bodyLimit('/mcp/k/some-key')).toBe(IMAGE_BODY);
		expect(bodyLimit('/kitchen-api/tool/read_image')).toBe(IMAGE_BODY);
		expect(bodyLimit('/api/tools/place_order')).toBe(SMALL_BODY);
		expect(bodyLimit('/api/chat/turn')).toBe(SMALL_BODY);
		expect(bodyLimit('/kitchen-api/scenario')).toBe(SMALL_BODY);
	});

	it('refuses a declared body over the route limit with 413, and passes the rest', async () => {
		expect((await run('/api/chat/turn', SMALL_BODY + 1)).status).toBe(413);
		expect((await run('/api/chat/turn', 2_000)).status).toBe(200);
		expect((await run('/api/tools/read_image', 5_000_000)).status).toBe(200);
		expect((await run('/api/tools/read_image', IMAGE_BODY + 1)).status).toBe(413);
	});
});

describe('request id', () => {
	it('returns a plain incoming x-request-id, or a fresh one, on every response', async () => {
		const kept = await run('/api/chat/turn', 10, { 'x-request-id': 'dbg-42' });
		expect(kept.headers.get('x-request-id')).toBe('dbg-42');
		const fresh = await run('/api/chat/turn', SMALL_BODY + 1, { 'x-request-id': 'bad id!' });
		expect(fresh.status).toBe(413);
		expect(fresh.headers.get('x-request-id')).toMatch(/^req-/);
	});
});
