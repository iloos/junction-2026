import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { readBriefAnswers } from '$lib/server/request';
import {
	acceptMenuAsChef,
	editMenu,
	planMenuAsChef,
	proposeFromRequest,
	readEdits,
	readMenuFor
} from '$lib/server/menu/server';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import type { RequestHandler } from './$types';

/**
 * The /request page's menu steps, in the browser's own workspace: `propose` (from the request words and brief
 * answers), `read`, `edit` (amounts per guest → a new revision), `accept` (the chef's review) and `plan`.
 * Domain refusals come back as 422 with the error code.
 */
export const POST: RequestHandler = async (event) => {
	const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
	const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
	const int = (k: string) => (Number.isInteger(body[k]) ? (body[k] as number) : -1);
	const { workspaceId } = await visitorWorkspace(event, env, dev);
	const ref = { workspaceId, id: str('id'), revision: int('revision') };

	const r =
		body.action === 'propose'
			? await proposeFromRequest({
					env,
					workspaceId,
					kitchenId: str('kitchenId') || 'k-hotel',
					text: str('text').slice(0, 500),
					briefAnswers: readBriefAnswers(body.briefAnswers),
					nonce: str('nonce') || undefined
				})
			: body.action === 'read'
				? await readMenuFor(workspaceId, ref.id)
				: body.action === 'edit'
					? await editMenu({ ...ref, edits: readEdits(body.edits) })
					: body.action === 'accept'
						? await acceptMenuAsChef({ env, ...ref })
						: body.action === 'plan'
							? await planMenuAsChef({ env, ...ref })
							: null;
	if (!r)
		return json({ error: { code: 'INVALID_INPUT', message: 'unknown action' } }, { status: 400 });
	return r.ok ? json(r.value) : json({ error: r.error }, { status: 422 });
};
