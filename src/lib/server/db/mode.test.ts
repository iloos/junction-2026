import { describe, expect, it } from 'vitest';
import { chooseDbMode } from './client';

const base = { url: 'postgres://x', dev: false, vitest: false, testPg: false, devUseRemote: false };

describe('which database a process uses', () => {
	it('keeps dev servers off the deployed database unless asked', () => {
		expect(chooseDbMode({ ...base, dev: true })).toBe('fixture');
		expect(chooseDbMode({ ...base, dev: true, devUseRemote: true })).toBe('postgres');
	});
	it('leaves the production build and scripts on DATABASE_URL', () => {
		expect(chooseDbMode(base)).toBe('postgres');
		expect(chooseDbMode({ ...base, url: undefined })).toBe('fixture');
	});
	it('keeps tests on PGlite unless the opt-in Postgres suite runs', () => {
		expect(chooseDbMode({ ...base, vitest: true, dev: true })).toBe('fixture');
		expect(chooseDbMode({ ...base, vitest: true, dev: true, testPg: true })).toBe('postgres');
		expect(chooseDbMode({ ...base, vitest: true, testPg: true, url: undefined })).toBe('fixture');
	});
});
