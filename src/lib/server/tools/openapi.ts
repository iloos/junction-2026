import { z } from 'zod';
import { createDocument } from 'zod-openapi';
import { DomainError, TOOL_NAMES, toolSchemas, type ToolName } from '$lib/core/contracts';
import { advertised } from './serve';
import { HTTP_STATUS } from './serve';

const DomainErrorBody = z.object({ error: DomainError }).meta({ id: 'ErrorBody' });

/** OpenAPI 3.1 for the REST mirror, generated from the same zod registry MCP serves. */
export function openApiDocument(serverUrl?: string) {
	const errorBody = { content: { 'application/json': { schema: DomainErrorBody } } };
	const statuses = [...new Set([...Object.values(HTTP_STATUS), 401, 500])].sort();
	const paths = Object.fromEntries(
		TOOL_NAMES.filter(advertised).map((name: ToolName) => {
			const t = toolSchemas[name];
			return [
				`/api/tools/${name}`,
				{
					post: {
						operationId: name,
						summary: t.description,
						description: `${t.description}\n\nRequires scope \`${t.scope}\`.`,
						tags: [t.scope],
						requestBody: {
							required: true,
							content: { 'application/json': { schema: t.input } }
						},
						responses: {
							200: { description: 'OK', content: { 'application/json': { schema: t.output } } },
							...Object.fromEntries(
								statuses.map((s) => [String(s), { description: `Error (${s})`, ...errorBody }])
							)
						}
					}
				}
			];
		})
	);
	return createDocument({
		openapi: '3.1.0',
		info: {
			title: 'Mandate tools',
			version: '0.1.0',
			description:
				'Kitchen purchasing tools with an enforceable mandate. The caller is derived from the bearer key; external agents can search, quote and place orders, which always wait for a human approval.'
		},
		servers: serverUrl ? [{ url: serverUrl }] : undefined,
		components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
		security: [{ bearer: [] }],
		paths
	});
}
