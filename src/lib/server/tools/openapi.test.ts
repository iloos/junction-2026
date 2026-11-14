import { afterEach, describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '$lib/core/contracts';
import { openApiDocument } from './openapi';

describe('openapi', () => {
	afterEach(() => {
		delete process.env.VISION_LIVE;
	});

	it('documents every advertised tool from the zod registry', () => {
		const doc = openApiDocument('http://localhost:5174');
		expect(doc.openapi).toBe('3.1.0');
		expect(Object.keys(doc.paths ?? {})).toEqual(
			TOOL_NAMES.filter((n) => n !== 'read_image').map((n) => `/api/tools/${n}`)
		);
		expect(JSON.stringify(doc)).toContain('external_agent_needs_approval');
	});

	it('lists read_image only once the vision endpoint is live', () => {
		process.env.VISION_LIVE = '1';
		const doc = openApiDocument('http://localhost:5175');
		expect(Object.keys(doc.paths ?? {})).toContain('/api/tools/read_image');
	});
});
