import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const secret = 'fixture-webhook-secret-for-tests';
const h = vi.hoisted(() => ({
	initialized: false,
	pg: {} as object | null,
	order: [] as string[],
	ready: vi.fn(),
	queue: vi.fn(),
	enqueue: vi.fn(),
	persist: vi.fn(),
	targets: vi.fn(),
	drain: vi.fn(),
	trace: vi.fn(),
	log: vi.fn()
}));
vi.mock('$env/dynamic/private', () => ({
	env: { CONTEXT_DEV_WEBHOOK_SECRET: 'fixture-webhook-secret-for-tests' }
}));
vi.mock('$lib/server/web', () => ({
	webStateReady: h.ready,
	webPg: () => h.pg,
	queueFor: h.queue,
	recallTargets: h.targets,
	findingsFor: vi.fn(),
	applicationsFor: vi.fn(),
	scopeOf: vi.fn(),
	webClients: vi.fn()
}));
vi.mock('$lib/server/web/persist', () => ({ retryStateWrites: h.persist }));
vi.mock('$lib/server/web/watch', () => ({
	enqueueChange: h.enqueue,
	drain: h.drain,
	busTrace: h.trace
}));
vi.mock('$lib/server/obs/log', () => ({
	log: { error: h.log },
	errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e))
}));
import { POST } from '../../../routes/api/web/contextdev/+server';

function request(
	body: unknown = { event: 'change.detected', data: { change: { id: 'change-1' } } }
) {
	const raw = JSON.stringify(body);
	const t = Math.floor(Date.now() / 1000);
	const sig = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
	return new Request('http://localhost/api/web/contextdev', {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-context-signature': `t=${t},v1=${sig}` },
		body: raw
	});
}
const post = async (r = request()) => POST({ request: r } as Parameters<typeof POST>[0]);

beforeEach(() => {
	vi.resetAllMocks();
	h.initialized = false;
	h.pg = {};
	h.order = [];
	h.ready.mockImplementation(async () => {
		h.order.push('ready');
		h.initialized = true;
	});
	h.queue.mockImplementation(() => {
		if (!h.initialized) throw new Error('queue opened before storage');
		h.order.push('queue');
		return {};
	});
	h.enqueue.mockImplementation(() => {
		h.order.push('enqueue');
		return ['notice:fixture'];
	});
	h.persist.mockImplementation(async () => void h.order.push('persist'));
	h.targets.mockResolvedValue([]);
});

describe('recall webhook durability boundary', () => {
	it('initializes storage before the first signed change is queued and accepted', async () => {
		const res = await post();
		expect(res.status).toBe(202);
		expect(h.order).toEqual(['ready', 'queue', 'enqueue', 'persist']);
		expect(await res.json()).toMatchObject({ accepted: true, queued: ['notice:fixture'] });
	});

	it('does not acknowledge or drain until persistence completes', async () => {
		let release!: () => void;
		h.persist.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
		let replied = false;
		const response = post().then((r) => {
			replied = true;
			return r;
		});
		await vi.waitFor(() => expect(h.persist).toHaveBeenCalledOnce());
		expect(replied).toBe(false);
		expect(h.targets).not.toHaveBeenCalled();
		release();
		expect((await response).status).toBe(202);
	});

	it('returns a retryable failure when initialization fails', async () => {
		h.ready.mockRejectedValue(new Error('database unavailable'));
		const res = await post();
		expect(res.status).toBe(503);
		expect(await res.json()).toMatchObject({
			error: { code: 'PROVIDER_UNAVAILABLE', retryable: true }
		});
		expect(h.enqueue).not.toHaveBeenCalled();
		expect(h.targets).not.toHaveBeenCalled();
	});

	it('does not accept a swallowed startup failure with no shared sink', async () => {
		h.pg = null;
		const res = await post();
		expect(res.status).toBe(503);
		expect(h.queue).not.toHaveBeenCalled();
		expect(h.drain).not.toHaveBeenCalled();
	});

	it('returns 503 on a failed queue write so the provider can redeliver', async () => {
		h.persist.mockRejectedValue(new Error('insert failed'));
		const res = await post();
		expect(res.status).toBe(503);
		expect(h.enqueue).toHaveBeenCalledOnce();
		expect(h.targets).not.toHaveBeenCalled();
		expect(h.drain).not.toHaveBeenCalled();
	});

	it.each(['startup', 'write'])(
		'accepts redelivery after a transient %s failure recovers',
		async (phase) => {
			if (phase === 'startup') h.ready.mockRejectedValueOnce(new Error('offline'));
			else h.persist.mockRejectedValueOnce(new Error('offline'));
			expect((await post()).status).toBe(503);
			const res = await post();
			expect(res.status).toBe(202);
			expect(await res.json()).toMatchObject({ accepted: true, queued: ['notice:fixture'] });
		}
	);

	it('retries previous persistence failures on run.completed without a new change', async () => {
		const res = await post(request({ event: 'run.completed' }));
		expect(res.status).toBe(200);
		expect(h.enqueue).not.toHaveBeenCalled();
		expect(h.persist).toHaveBeenCalledOnce();
	});

	it('can defer processing after a durable enqueue if target lookup fails', async () => {
		h.targets.mockRejectedValue(new Error('targets unavailable'));
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const res = await post();
			expect(res.status).toBe(202);
			expect(await res.json()).toMatchObject({ accepted: true, deferred: true });
			expect(h.persist).toHaveBeenCalledOnce();
		} finally {
			spy.mockRestore();
		}
	});

	it('refuses unsigned changes before initializing or queueing anything', async () => {
		const r = request();
		r.headers.delete('x-context-signature');
		expect((await post(r)).status).toBe(401);
		expect(h.ready).not.toHaveBeenCalled();
		expect(h.enqueue).not.toHaveBeenCalled();
	});

	it.each([null, [], 'change.detected'])(
		'refuses signed non-object payload %j before opening storage',
		async (body) => {
			expect((await post(request(body))).status).toBe(400);
			expect(h.ready).not.toHaveBeenCalled();
		}
	);
});
