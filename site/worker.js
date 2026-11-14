// Static site for mandate.kitchen: the landing page and the presenting pages live in public/.
// Paths the site doesn't have go to the app on app.mandate.kitchen (Aiven Runtime takes subdomains
// only), so mandate.kitchen/agents and older links still land in the app.
const APP = 'https://app.mandate.kitchen';

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (url.hostname === 'www.mandate.kitchen') {
			return Response.redirect(`https://mandate.kitchen${url.pathname}${url.search}`, 301);
		}
		const res = await env.ASSETS.fetch(request);
		if (res.status !== 404) return res;
		return Response.redirect(`${APP}${url.pathname}${url.search}`, 302);
	}
};
