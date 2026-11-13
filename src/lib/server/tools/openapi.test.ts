import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '$lib/core/contracts';
import { openApiDocument } from './openapi';

describe('openapi', () => {
	it('documents every tool from the zod registry', () => {
		const doc = openApiDocument('http://localhost:5174');
		expect(doc.openapi).toBe('3.1.0');
		expect(Object.keys(doc.paths ?? {})).toEqual(TOOL_NAMES.map((n) => `/api/tools/${n}`));
		expect(JSON.stringify(doc)).toContain('external_agent_needs_approval');
	});
});
