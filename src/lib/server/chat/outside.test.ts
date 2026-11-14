import { describe, expect, it } from 'vitest';
import { ok } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { OUTSIDE_LABEL, outsideOptions, outsideSteps } from './outside';

const ctx: CallContext = {
	workspaceId: 'ws-j-test',
	runId: 'run-1',
	actor: { kind: 'kitchen_agent', id: 'routine' },
	scopes: ['read', 'plan', 'order'],
	via: 'chat'
};

function handlersWith(options: { title: string; url: string }[]) {
	const asked: string[] = [];
	const handlers = {
		find_outside: async (_c: CallContext, input: { need: string }) => {
			asked.push(input.need);
			return ok({
				options: options.map((o) => ({ ...o, provenance: { source: 'web' as const, ref: o.url } }))
			});
		}
	} as unknown as ToolHandlers;
	return { handlers, asked };
}

describe('outside options after a shortage repair', () => {
	it('labels options as information, not orderable, and names the site', async () => {
		const { handlers } = handlersWith([
			{ title: 'Smoked salmon, 1 kg', url: 'https://www.example-fish.fi/lohi' }
		]);
		const o = await outsideOptions([{ needId: 'n1', label: 'cold-smoked salmon' }], ctx, handlers);
		expect(o?.text).toContain(OUTSIDE_LABEL);
		expect(o?.text).toContain('example-fish.fi');
		expect(o?.sources).toEqual([
			{
				url: 'https://www.example-fish.fi/lohi',
				title: 'Smoked salmon, 1 kg',
				host: 'example-fish.fi'
			}
		]);
		const lines = outsideSteps('t1', 3, o!);
		expect(lines).toMatchObject([{ type: 'step', n: 4, tool: 'find_outside', ok: true }]);
	});

	it('looks up at most two needs, and nothing when every need is resolved', async () => {
		const { handlers, asked } = handlersWith([]);
		expect(await outsideOptions([], ctx, handlers)).toBeNull();
		const o = await outsideOptions(
			[
				{ needId: 'a', label: 'a' },
				{ needId: 'b', label: 'b' },
				{ needId: 'c', label: 'c' }
			],
			ctx,
			handlers
		);
		expect(asked).toEqual(['a', 'b']);
		expect(o?.text).toBe('');
	});
});
