import type { DomainError, ToolInput, ToolName, ToolOutput } from '$lib/core/contracts';
import { ToolError, fixtureCall } from './fixture-server';

/**
 * The kitchen UI's one seam to the server: `POST /api/tools/<name>` with the contract in core/contracts/tools.ts.
 * `fixture` runs the same tools in the browser over christmas-buffet-140.json, so the whole journey works offline.
 * Flip with VITE_KITCHEN_API=live once the agent and core-db lanes serve the routes.
 */
export type ApiMode = 'fixture' | 'live';

export const API_MODE: ApiMode = import.meta.env.VITE_KITCHEN_API === 'live' ? 'live' : 'fixture';

export { ToolError };

async function liveCall<N extends ToolName>(name: N, input: ToolInput<N>): Promise<ToolOutput<N>> {
	const res = await fetch(`/api/tools/${name}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	});
	const body = (await res.json().catch(() => null)) as
		(ToolOutput<N> & { error?: undefined }) | { error: DomainError } | null;
	if (!res.ok || !body || 'error' in body) {
		const error: DomainError =
			body && 'error' in body && body.error
				? body.error
				: { code: 'PROVIDER_UNAVAILABLE', message: `HTTP ${res.status}`, retryable: true };
		throw new ToolError(error);
	}
	return body as ToolOutput<N>;
}

export function call<N extends ToolName>(name: N, input: ToolInput<N>): Promise<ToolOutput<N>> {
	return API_MODE === 'live' ? liveCall(name, input) : fixtureCall(name, input);
}
