/** A bug or an outage on our side reaches the chef as plain words: never a tool name, a query or a table. */
import { describe, expect, it } from 'vitest';
import type { StepRecord } from '$lib/server/agent/loop';
import { stepEvents } from './turn';

describe('internal errors in the chat', () => {
	it('an INTERNAL step says something went wrong, without the tool or the cause', () => {
		const s: StepRecord = {
			n: 1,
			tool: 'propose_menu',
			input: {},
			why: '',
			ok: false,
			error: {
				code: 'INTERNAL',
				message: 'propose_menu failed unexpectedly: update "agent_tasks" set ...',
				retryable: false
			},
			ms: 5
		};
		const [e] = stepEvents('task-x', [s]);
		expect(e.type === 'step' && e.summary).toBe(
			'Not done: something went wrong on our side. Try again, or ask what is open.'
		);
		expect(JSON.stringify(e)).not.toMatch(/agent_tasks|failed unexpectedly/);
	});
});
