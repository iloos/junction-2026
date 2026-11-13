import { handleMcp } from '$lib/server/tools/mcp-endpoint';
import type { RequestHandler } from './$types';

const handle: RequestHandler = ({ request }) => handleMcp(request);
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = handle;
