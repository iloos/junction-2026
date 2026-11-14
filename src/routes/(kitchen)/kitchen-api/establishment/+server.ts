import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { createLlmRouter } from '$lib/server/adapters/llm/router';
import { contextFor } from '$lib/server/auth';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import { onCurrentRun } from '$lib/server/demo/reset';
import { MAX_DESCRIPTION, matchEstablishment } from '$lib/server/establishment';
import { withCallScope } from '$lib/server/scope';
import { createServerPorts } from '$lib/server/store/server-ports';
import { json } from '$lib/server/tools/http';
import type { RequestHandler } from './$types';

const bad = (message: string) =>
	json({ error: { code: 'INVALID_INPUT', message, retryable: false } }, 400);

/**
 * POST /kitchen-api/establishment `{text}` → `{kitchenId, why, notes, close, source}`: the seeded kitchen nearest to
 * the chef's description, in this browser's own workspace (D15). Gemini Flash-Lite when a provider is configured
 * (traced into the visitor's drawer and counted against the visitor's caps), the rules otherwise or on any failure.
 * A read: it chooses nothing; the picker's onchoose does.
 */
export const POST: RequestHandler = async (event) => {
	let body: { text?: unknown };
	try {
		body = await event.request.json();
	} catch {
		return bad('body is not JSON');
	}
	const text = typeof body.text === 'string' ? body.text.trim() : '';
	if (text.length < 3) return bad('text is required: a sentence about your kitchen');
	if (text.length > MAX_DESCRIPTION) return bad(`text is over ${MAX_DESCRIPTION} characters`);

	const v = await visitorWorkspace(event, env, dev);
	const ctx = await onCurrentRun(contextFor('chef', 'chef', 'join', env, v.workspaceId));
	const { ports } = await createServerPorts();
	const kitchens = await ports.store.kitchens(v.workspaceId);
	if (!kitchens.length) return bad('no kitchens in this workspace');
	const live = (env.LLM_PROVIDER ?? 'fixture') !== 'fixture';
	const match = await withCallScope(ctx, () =>
		matchEstablishment(
			text,
			kitchens,
			live ? createLlmRouter(env).for('establishment.match') : null,
			event.request.signal
		)
	);
	// Why a model answer was dropped stays server-side (the trace has the call); the chef sees the match.
	return json(
		{
			kitchenId: match.kitchenId,
			why: match.why,
			notes: match.notes,
			close: match.close,
			source: match.source
		},
		200
	);
};
