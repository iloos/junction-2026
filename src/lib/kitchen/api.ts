import type { DomainError, ToolInput, ToolName, ToolOutput } from '$lib/core/contracts';
import { ToolError, fixtureCall } from './fixture-server';

/**
 * The kitchen UI's one seam to the server. Live: `POST /kitchen-api/tool/<name>`, which acts as the chef
 * server-side on this session's plan only. Fixture: the same tools in the browser over christmas-buffet-140.json,
 * used only by the explicit, labelled offline demonstration (/offline). A store is one or the other for its whole
 * life: a live failure never switches it to the fixture basket.
 */
export type ApiMode = 'fixture' | 'live';

export { ToolError };

/** The server could not be reached at all (as opposed to answering with an error). */
export class Unreachable extends ToolError {}

/**
 * What the page currently shows (run, plan, version), sent with every live tool call: the server refuses a
 * command from a page that is out of date (STALE_VERSION) instead of acting on a plan the chef never saw.
 */
export const rendered: { view: RenderedView | null } = {
	view: null
};

export type RenderedView = { runId: string; planId: string; version: number };

/**
 * This browser tab, on every Kitchen command, so its ops read `kitchen#<tab>` (or `dock#<tab>`): a screen tells its
 * own commands from another tab's (R11-07).
 */
export const TAB =
	typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
		: Math.random().toString(36).slice(2, 12);

export async function livePost<T>(
	path: string,
	body: unknown,
	/** The view of the screen sending it (each Kitchen state keeps its own); the page's when absent. */
	view: RenderedView | null = rendered.view,
	/** The agent dock's own Kitchen state says so, so its ops read "in the agent dock" on the page. */
	surface?: 'dock'
): Promise<T> {
	let res: Response;
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (surface) headers['x-kitchen-surface'] = surface;
	if (path.startsWith('/kitchen-api/')) headers['x-kitchen-tab'] = TAB;
	if (path.startsWith('/kitchen-api/tool/') && view)
		headers['x-kitchen-view'] = JSON.stringify(view);
	try {
		res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
	} catch (e) {
		throw new Unreachable({
			code: 'PROVIDER_UNAVAILABLE',
			message: `server unreachable: ${e instanceof Error ? e.message : String(e)}`,
			retryable: true
		});
	}
	const out = (await res.json().catch(() => null)) as
		(T & { error?: undefined }) | { error: DomainError } | null;
	if (!res.ok || !out || 'error' in out) {
		const error: DomainError =
			out && 'error' in out && out.error
				? out.error
				: { code: 'PROVIDER_UNAVAILABLE', message: `HTTP ${res.status}`, retryable: true };
		throw new ToolError(error);
	}
	return out as T;
}

export function call<N extends ToolName>(
	mode: ApiMode,
	name: N,
	input: ToolInput<N>,
	view?: RenderedView | null,
	surface?: 'dock'
): Promise<ToolOutput<N>> {
	return mode === 'live'
		? livePost<ToolOutput<N>>(
				`/kitchen-api/tool/${name}`,
				input,
				view === undefined ? rendered.view : view,
				surface
			)
		: fixtureCall(name, input);
}
