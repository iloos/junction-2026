import type { DomainError, ToolInput, ToolName, ToolOutput } from '$lib/core/contracts';
import { ToolError, fixtureCall } from './fixture-server';

/**
 * The kitchen UI's one seam to the server. Live (default): `POST /kitchen-api/tool/<name>`, which acts as the
 * chef server-side, so the browser holds no key. Fixture: the same tools run in the browser over
 * christmas-buffet-140.json, used when VITE_KITCHEN_API=fixture or when the server can't be reached.
 */
export type ApiMode = 'fixture' | 'live';

let mode: ApiMode = import.meta.env.VITE_KITCHEN_API === 'fixture' ? 'fixture' : 'live';

export function apiMode(): ApiMode {
	return mode;
}

/** Falls back to the in-browser fixture for the rest of the session (offline demo). */
export function useFixture() {
	mode = 'fixture';
}

export { ToolError };

export async function livePost<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
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

export function call<N extends ToolName>(name: N, input: ToolInput<N>): Promise<ToolOutput<N>> {
	return mode === 'live'
		? livePost<ToolOutput<N>>(`/kitchen-api/tool/${name}`, input)
		: fixtureCall(name, input);
}
