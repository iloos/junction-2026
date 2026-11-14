import { describe, expect, it } from 'vitest';
import { dbMode } from './client';

describe('dbMode under test', () => {
	it('is fixture even when .env has DATABASE_URL, so tests never touch the shared Aiven DB', () => {
		expect(dbMode()).toBe('fixture');
	});
});
