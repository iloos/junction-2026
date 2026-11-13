import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { handlers } from './handlers';
import { createMcpEndpoint } from './mcp';

/** The app's MCP endpoint, shared by `/mcp` (header key) and `/mcp/k/<key>` (path key). */
export const handleMcp = createMcpEndpoint(handlers, { env, dev });
