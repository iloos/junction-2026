import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { inScope, readBriefAnswers } from '$lib/server/request';
import {
	acceptMenuAsChef,
	editMenuFor,
	planMenuAsChef,
	proposeFromRequest,
	readChanges,
	readMenuFor
} from '$lib/server/menu/server';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import { readMenuBody } from '$lib/server/menu/body';
import type { RequestHandler } from './$types';

/**
 * The /request page's menu steps, in the browser's own workspace: `propose` (from the request words and brief
 * answers), `read`, `edit` (amounts per guest → a new revision), `accept` (the chef's review) and `plan`.
 * A malformed envelope is a 400 with the reason (readMenuBody); domain refusals come back as 422 with the error code.
 */
export const POST: RequestHandler = async (event) => {
	let raw: unknown;
	try {
		raw = await event.request.json();
	} catch {
		return json({ error: { code: 'INVALID_INPUT', message: 'body is not JSON' } }, { status: 400 });
	}
	const read = readMenuBody(raw);
	if (!read.ok)
		return json({ error: { code: 'INVALID_INPUT', message: read.reason } }, { status: 400 });
	const { body } = read;
	const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
	const int = (k: string) => (Number.isInteger(body[k]) ? (body[k] as number) : -1);
	const { workspaceId } = await visitorWorkspace(event, env, dev);
	const ref = { workspaceId, id: str('id'), revision: int('revision') };

	// Proposing takes seconds (a model call, then one catalogue match per ingredient): it streams NDJSON lines,
	// {progress} as the dishes and products come in, then {result} or {error}.
	if (body.action === 'propose') {
		const enc = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
				try {
					const r = await inScope(workspaceId, () =>
						proposeFromRequest({
							env,
							workspaceId,
							kitchenId: str('kitchenId') || 'k-hotel',
							text: str('text').slice(0, 500),
							briefAnswers: readBriefAnswers(body.briefAnswers),
							nonce: str('nonce') || undefined,
							onStep: (progress) => send({ progress })
						})
					);
					send(r.ok ? { result: r.value } : { error: r.error });
				} catch (e) {
					send({
						error: { code: 'INTERNAL', message: e instanceof Error ? e.message : String(e) }
					});
				}
				controller.close();
			}
		});
		return new Response(stream, {
			headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' }
		});
	}

	// Every step runs on this workspace's own run and clock.
	const r = await inScope(workspaceId, async () =>
		body.action === 'read'
			? await readMenuFor(workspaceId, ref.id)
			: body.action === 'edit'
				? await editMenuFor({ ...ref, changes: readChanges(body.changes) })
				: body.action === 'accept'
					? await acceptMenuAsChef({ env, ...ref })
					: body.action === 'plan'
						? await planMenuAsChef({ env, ...ref })
						: null
	);
	if (!r)
		return json({ error: { code: 'INVALID_INPUT', message: 'unknown action' } }, { status: 400 });
	return r.ok ? json(r.value) : json({ error: r.error }, { status: 422 });
};
