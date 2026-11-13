import { handleMcp } from '$lib/server/tools/mcp-endpoint';
import type { RequestHandler } from './$types';

/** Key in the path for clients that cannot send headers (claude.ai / ChatGPT custom connectors). */
const handle: RequestHandler = ({ request, params }) => handleMcp(request, params.key);
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = handle;
