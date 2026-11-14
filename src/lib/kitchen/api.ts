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

export async function livePost<T>(path: string, body: unknown): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
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
	input: ToolInput<N>
): Promise<ToolOutput<N>> {
	return mode === 'live'
		? livePost<ToolOutput<N>>(`/kitchen-api/tool/${name}`, input)
		: fixtureCall(name, input);
}
