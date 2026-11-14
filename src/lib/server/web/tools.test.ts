/**
 * The planned web tools (contracts/tools-next.ts) on fixtures: schema-valid outputs, the caller's
 * workspace (F19), read-only lookups, and caps surfacing as a wait-and-retry error.
 */
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext, WebExecutionContext } from '$lib/core/ports';
import { createDbPorts } from '../store/db-ports';
import { createApplications } from './applications';
import type { FactSearch } from './exa';
import {
	createFixtureFactSearch,
	createFixtureRecallSource,
	EGG_RECALL_URL,
	recordedNotice
} from './fixture';
import { createFindings } from './findings';
import { ingestRecall } from './ingest';
import { memoryIndex } from './recall';
import { resultJson } from './route';
import { WebLimitError } from './spend';
import { createWebTools } from './tools';
import { replayRecorded } from './watch';

const ctx = (workspaceId: string): CallContext => ({
	workspaceId,
	runId: 'run-tools',
	actor: { kind: 'external_agent', id: `judge-${workspaceId}` },
	scopes: SCOPES_BY_ACTOR.external_agent,
	via: 'test'
});

async function setup(exa: FactSearch = createFixtureFactSearch()) {
	const env = await createDbPorts({ runId: 'run-tools' });
	const w = (ws: string): WebExecutionContext => ({
		ctx: ctx(ws),
		ports: {
			clock: env.ports.clock,
			catalog: env.ports.catalog,
			store: env.store,
			web: env.ports.web
		},
		spendKey: `external_agent:judge-${ws}`
	});
	const findings = createFindings(undefined, true);
	const seen: string[] = [];
	const tools = createWebTools({
		clients: (x) => {
			seen.push(x.spendKey);
			return { exa, recalls: createFixtureRecallSource() };
		},
		findings
	});
	return { env, w, findings, tools, seen };
}

describe('web tools (fixtures)', { timeout: 30_000 }, () => {
	it('lookup_facts: schema-valid facts with gtinCited and sources, charged to the caller, recording nothing', async () => {
		const { env, w, findings, tools, seen } = await setup();
		const before = (await env.store.load('ws-a', 'run-tools')).enrichments;
		const r = await tools.lookup_facts(w('ws-a'), { productId: '460002' });
		if (!r.ok) throw new Error(r.error.message);
		const ing = r.value.facts.find((f) => f.field === 'ingredients')!;
		expect(ing).toMatchObject({ gtinCited: true, provenance: { source: 'web' } });
		expect(ing.sources[0].url).toContain('6416796729140');
		expect(r.value.meta?.summary).toMatch(/cite its GTIN/);
		expect(seen).toEqual(['external_agent:judge-ws-a']);
		expect((await env.store.load('ws-a', 'run-tools')).enrichments).toEqual(before);
		expect(findings.list('facts', 'ws-b')).toEqual([]); // another workspace doesn't see it
		expect(findings.list('facts', 'ws-a')).toHaveLength(1);
	});

	it('lookup_facts: bad input is INVALID_INPUT, an unknown product NOT_FOUND', async () => {
		const { w, tools } = await setup();
		expect(await tools.lookup_facts(w('ws-a'), {})).toMatchObject({
			ok: false,
			error: { code: 'INVALID_INPUT' }
		});
		expect(await tools.lookup_facts(w('ws-a'), { productId: '999999' })).toMatchObject({
			ok: false,
			error: { code: 'NOT_FOUND' }
		});
	});

	it('a daily cap is a retryable error with retryAfter, and the route answers 429', async () => {
		const capped: FactSearch = {
			mode: 'live',
			search: async () => [],
			structured: async () => {
				throw new WebLimitError('cap-key', 'exa', 3600);
			}
		};
		const { w, tools } = await setup(capped);
		const r = await tools.lookup_facts(w('ws-a'), { productId: '460002' });
		expect(r).toMatchObject({
			ok: false,
			error: {
				code: 'PROVIDER_UNAVAILABLE',
				sub: 'daily_cap',
				retryable: true,
				detail: { retryAfter: 3600 }
			}
		});
		const res = resultJson(r);
		expect(res.status).toBe(429);
		expect(res.headers.get('retry-after')).toBe('3600');
	});

	it('find_outside: options with a source URL and provenance, never ordered', async () => {
		const { w, tools } = await setup();
		const r = await tools.find_outside(w('ws-a'), {
			need: 'joulutorttu',
			amount: { value: 140, unit: 'pcs' }
		});
		if (!r.ok) throw new Error(r.error.message);
		expect(r.value.options.length).toBeGreaterThan(0);
		expect(r.value.options[0]).toMatchObject({
			url: expect.stringMatching(/^https:\/\//),
			provenance: { source: 'web' }
		});
	});

	it("check_recall: a drill shows only in its own workspace; the real notice shows as 'none' for a non-cited product", async () => {
		const { env, w, findings, tools } = await setup();
		const product = (await env.ports.catalog.get(['460002'])).get('460002')!;
		const deps = {
			store: env.store,
			index: memoryIndex([product]),
			findings,
			applications: createApplications(undefined, true)
		};
		await replayRecorded(
			{ ...deps, scope: { workspaceId: 'ws-a', runId: 'run-tools' } },
			{ drillGtin: product.gtin }
		);
		await ingestRecall(recordedNotice(EGG_RECALL_URL)!, {
			...deps,
			scope: { workspaceId: 'ws-a', runId: 'run-tools' }
		});

		const a = await tools.check_recall(w('ws-a'), { productId: '460002' });
		if (!a.ok) throw new Error(a.error.message);
		expect(a.value.notices[0]).toMatchObject({ match: 'gtin', drill: true, url: EGG_RECALL_URL });
		expect(a.value.notices.find((n) => !n.drill)).toMatchObject({ match: 'none' });
		expect(a.value.meta?.summary).toMatch(/Only a drill/);

		const b = await tools.check_recall(w('ws-b'), { productId: '460002' });
		if (!b.ok) throw new Error(b.error.message);
		expect(b.value.notices.map((n) => n.drill)).toEqual([false]);
		expect(b.value.meta?.summary).toMatch(/No watched recall notice cites/);
	});
});
