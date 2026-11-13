import { openApiDocument } from '$lib/server/tools/openapi';
import { json } from '$lib/server/tools/http';
import type { RequestHandler } from './$types';

let cached: unknown;

export const GET: RequestHandler = ({ url }) => {
	cached ??= openApiDocument(url.origin);
	return json(cached);
};
