import type { ToolHandlers } from '$lib/core/ports';
import { stubHandlers } from './stub-handlers';

/**
 * The handlers every surface serves. STUB until the core-db lane delivers its services: replace this
 * one import (REST, MCP and the routine agent all read `handlers` from here).
 */
export const handlers: ToolHandlers = stubHandlers;
