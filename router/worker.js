// Sticky router: one public URL in front of several Aiven app machines that share one Postgres.
// A browser is pinned to one upstream by the `mk_up` cookie set on its first visit, so the per-process state
// (kitchen session, pairing, agent runs) stays on the machine that made it; everything shared lives in Postgres
// and crosses machines over LISTEN/NOTIFY. Responses stream through untouched, so /api/events (SSE) works.
//
// Config (wrangler vars): UPSTREAMS = comma-separated https origins, e.g. "https://a.aiven.app,https://b.aiven.app".

const COOKIE = 'mk_up';
const DAY_S = 86400;

function upstreams(env) {
	return String(env.UPSTREAMS || '')
		.split(',')
		.map((s) => s.trim().replace(/\/+$/, ''))
		.filter((s) => /^https:\/\//.test(s));
}

function pinned(request, n) {
	const m = /(?:^|;\s*)mk_up=(\d+)/.exec(request.headers.get('cookie') || '');
	const i = m ? Number(m[1]) : NaN;
	return Number.isInteger(i) && i >= 0 && i < n ? i : null;
}

/** The request as the upstream should see it: its own origin, so the app's same-origin checks pass. */
function forward(request, upstream, url) {
	const target = upstream + url.pathname + url.search;
	const headers = new Headers(request.headers);
	headers.delete('host');
	if (headers.has('origin')) headers.set('origin', upstream);
	const ref = headers.get('referer');
	if (ref) {
		try {
			const r = new URL(ref);
			headers.set('referer', upstream + r.pathname + r.search);
		} catch {
			headers.delete('referer');
		}
	}
	headers.set('x-forwarded-host', url.host);
	headers.set('x-mandate-router', '1');
	const init = { method: request.method, headers, redirect: 'manual' };
	if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
	return new Request(target, init);
}

/** The upstream's answer for the browser: redirects back onto the router's host, and the pin cookie when new. */
function back(response, upstream, url, setPin) {
	const headers = new Headers(response.headers);
	const loc = headers.get('location');
	if (loc && loc.startsWith(upstream))
		headers.set('location', url.origin + loc.slice(upstream.length));
	if (setPin !== null)
		headers.append(
			'set-cookie',
			`${COOKIE}=${setPin}; Path=/; Max-Age=${DAY_S}; Secure; HttpOnly; SameSite=Lax`
		);
	headers.set('x-mandate-upstream', String(setPin ?? 'pinned'));
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

export default {
	async fetch(request, env) {
		const ups = upstreams(env);
		if (!ups.length) return new Response('router: no UPSTREAMS configured', { status: 503 });
		const url = new URL(request.url);

		if (url.pathname === '/__router')
			return Response.json({ upstreams: ups.length, pinned: pinned(request, ups.length) });

		const pin = pinned(request, ups.length);

		// A phone opening a pairing link has no pin yet: the token lives on the machine that minted it.
		if (pin === null && url.pathname.startsWith('/pair/t/') && request.method === 'GET') {
			for (let i = 0; i < ups.length; i++) {
				const r = await fetch(forward(request, ups[i], url));
				if (r.status !== 404) return back(r, ups[i], url, i);
			}
			return new Response('Pairing link not found or expired.', { status: 404 });
		}

		// New browsers spread evenly; the pin then keeps them on one machine.
		const i = pin ?? Math.floor(Math.random() * ups.length);
		const r = await fetch(forward(request, ups[i], url));
		return back(r, ups[i], url, pin === null ? i : null);
	}
};
