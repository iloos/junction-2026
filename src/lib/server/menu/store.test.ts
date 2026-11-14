import { describe, expect, it } from 'vitest';
import type { MenuProposal } from '$lib/core/contracts';
import type { MenuStore } from '$lib/core/ports';
import { createFixtureDb } from '../db/pglite';
import { workspaces } from '../db/schema';
import type { AnyDb } from '../store/drizzle-store';
import { drizzleMenuStore } from './pg';
import { memoryMenuStore, proposalDigest } from './store';

/** Both adapters must keep the same rules; the Postgres one runs on PGlite with the real migrations. */
const ADAPTERS: { name: string; make: () => Promise<MenuStore> }[] = [
	{ name: 'memory', make: async () => memoryMenuStore() },
	{
		name: 'postgres',
		make: async () => {
			const db = (await createFixtureDb()).db as unknown as AnyDb;
			await db
				.insert(workspaces)
				.values(['ws', 'ws-a', 'ws-b'].map((id) => ({ id, name: id })))
				.onConflictDoNothing();
			return drizzleMenuStore(db);
		}
	}
];

const AT = new Date('2026-12-07T09:00:00Z');
const chef = { kind: 'chef', id: 'chef' } as const;

function proposal(revision = 0, amount = 120): MenuProposal {
	return {
		id: 'menu-1',
		revision,
		kitchenId: 'k-hotel',
		status: 'proposed',
		brief: {
			title: 'Christmas dinner for 50',
			date: '2026-12-20',
			guests: 50,
			serviceStyle: 'plated',
			courses: 3,
			dietary: ['lactose-free'],
			provenance: { source: 'parsed' }
		},
		dishes: [
			{
				id: 'd-main',
				name: 'Roast ham',
				course: 'main',
				claimedCompatible: ['lactose-free'],
				ingredients: [
					{
						id: 'i-ham',
						label: 'ham',
						query: 'kinkku',
						amountPerCover: amount,
						unit: 'g',
						provenance: { source: 'llm' }
					}
				],
				provenance: { source: 'llm' }
			}
		],
		open: [],
		provenance: { source: 'llm', ref: 'gemini-test' }
	};
}

describe.each(ADAPTERS)('$name MenuStore', ({ make }) => {
	it('stores revisions per workspace, densely, and returns copies', async () => {
		const s = await make();
		await s.put('ws-a', proposal(0));
		await s.put('ws-a', proposal(1, 110));
		expect((await s.latest('ws-a', 'menu-1'))?.revision).toBe(1);
		expect((await s.get('ws-a', 'menu-1', 0))?.dishes[0].ingredients[0].amountPerCover).toBe(120);
		expect(await s.latest('ws-b', 'menu-1')).toBeNull();
		const got = (await s.get('ws-a', 'menu-1', 1))!;
		got.dishes[0].name = 'changed';
		expect((await s.get('ws-a', 'menu-1', 1))!.dishes[0].name).toBe('Roast ham');
	});

	it('refuses gaps, rewrites and self-reviewed puts; a retried put is a no-op', async () => {
		const s = await make();
		await expect(s.put('ws', proposal(1))).rejects.toThrow(/out of order/);
		await s.put('ws', proposal(0));
		await s.put('ws', proposal(0));
		await expect(s.put('ws', proposal(0, 999))).rejects.toThrow(/already exists/);
		await expect(s.put('ws', { ...proposal(1), status: 'chef_reviewed' })).rejects.toThrow(
			/review\(\) records a review/
		);
		await expect(
			s.put('ws', { ...proposal(1), review: { by: chef, at: AT.toISOString(), digest: 'x' } })
		).rejects.toThrow(/proposed revisions only/);
	});

	it('only a chef reviews, only the latest revision, and the record binds the digest', async () => {
		const s = await make();
		await s.put('ws', proposal(0));
		await s.put('ws', proposal(1, 110));
		const agent = await s.review('ws', 'menu-1', 1, { kind: 'kitchen_agent', id: 'a' }, AT);
		expect(agent.ok || agent.error.code).toBe('FORBIDDEN');
		const stale = await s.review('ws', 'menu-1', 0, chef, AT);
		expect(stale.ok || stale.error.code).toBe('STALE_VERSION');
		const missing = await s.review('ws', 'menu-9', 0, chef, AT);
		expect(missing.ok || missing.error.code).toBe('NOT_FOUND');

		const r = await s.review('ws', 'menu-1', 1, chef, AT);
		if (!r.ok) throw new Error(r.error.message);
		expect(r.value).toMatchObject({
			status: 'chef_reviewed',
			review: { by: chef, at: AT.toISOString(), digest: await proposalDigest(proposal(1, 110)) }
		});
		// A second review keeps the first record.
		const again = await s.review('ws', 'menu-1', 1, chef, new Date('2026-12-08T00:00:00Z'));
		expect(again.ok && again.value.review?.at).toBe(AT.toISOString());
		// An edit is a new revision and needs its own review.
		await s.put('ws', proposal(2, 100));
		expect((await s.latest('ws', 'menu-1'))?.status).toBe('proposed');
	});

	it('the digest ignores status and review, and changes with any amount', async () => {
		const a = await proposalDigest(proposal(0));
		expect(
			await proposalDigest({
				...proposal(0),
				status: 'chef_reviewed',
				review: { by: chef, at: AT.toISOString(), digest: 'x' }
			})
		).toBe(a);
		expect(await proposalDigest(proposal(0, 121))).not.toBe(a);
	});
});
