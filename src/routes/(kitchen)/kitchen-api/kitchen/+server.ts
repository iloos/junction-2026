import { json } from '@sveltejs/kit';
import { newKitchen } from '$lib/server/kitchen/live';
import { sid } from '$lib/server/kitchen/sid';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { roomNotice, visitorWorkspace } from '$lib/server/demo/visitor';
import type { RequestHandler } from './$types';

/**
 * Make this browser's own kitchen (create_kitchen, D24/D25): `{ name, profile?, description?, city? }`. Copied from
 * the sample of `profile`, or blank. Owned by this visitor, in whatever room it is in (its sandbox or the shared
 * room). Returns `{ kitchen, roomNotice? }`; `join` can open it next.
 */
export const POST: RequestHandler = async (event) => {
	const { request, cookies } = event;
	const v = await visitorWorkspace(event, env, dev);
	const input = await request.json().catch(() => ({}));
	const r = await newKitchen(
		sid(cookies),
		v.workspaceId,
		{ own: v.own, kind: v.kind, presenter: v.presenter },
		input,
		roomNotice(v)
	);
	return r.ok ? json(r.value) : json({ error: r.error }, { status: r.status });
};
