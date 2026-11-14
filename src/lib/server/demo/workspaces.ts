/**
 * The named workspaces (deploy.md "Workspaces and rooms"). Visitor sandboxes are `ws-j-<24 hex>` (visitor-id.ts).
 * No imports: auth, the bus, the store and the routes all read these.
 */
/** The stage: presenters only. */
export const DEMO_WORKSPACE = 'ws-demo';
/** The shared room every visitor can open, and where new visitors go once sandboxes are full. */
export const JUDGES_WORKSPACE = 'ws-judges';
/** The scripted simulated run /ops plays (memory only). */
export const SYNTH_WORKSPACE = 'ws-synth';
/** The dev-only load test (memory only). */
export const STRESS_WORKSPACE = 'ws-stress';
/** The deploy smoke's commit race check (its own MCP_KEYS key). */
export const SMOKE_WORKSPACE = 'ws-smoke';
