import { describe, expect, it } from 'vitest';
import { readMenuBody } from './body';

describe('the /request/menu envelope', () => {
	it('refuses null, unknown actions and missing references with a reason', () => {
		expect(readMenuBody(null)).toMatchObject({ ok: false });
		expect(readMenuBody([])).toMatchObject({ ok: false });
		expect(readMenuBody({ action: 'drop' })).toMatchObject({
			ok: false,
			reason: expect.stringMatching(/action/)
		});
		expect(readMenuBody({ action: 'accept', id: 'm-1' })).toMatchObject({
			ok: false,
			reason: expect.stringMatching(/revision/)
		});
		expect(readMenuBody({ action: 'read', id: '../x' })).toMatchObject({ ok: false });
		expect(readMenuBody({ action: 'propose', text: 42 })).toMatchObject({ ok: false });
	});
	it('accepts the steps the page sends', () => {
		expect(readMenuBody({ action: 'propose', text: 'Dinner for 40 on Saturday' })).toMatchObject({
			ok: true
		});
		expect(readMenuBody({ action: 'read', id: 'm-8b79' })).toMatchObject({ ok: true });
		expect(readMenuBody({ action: 'plan', id: 'm-8b79', revision: 0 })).toMatchObject({ ok: true });
	});
});
