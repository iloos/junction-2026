// Spike helper: one Context.dev or Exa call, raw JSON to stdout. Run with `node --env-file=.env scripts/web/cd.mjs <api> <path> <json-body|->`.
const [api, path, body] = process.argv.slice(2);
const isExa = api === 'exa';
const base = isExa ? 'https://api.exa.ai' : 'https://api.context.dev/v1';
const key = isExa ? process.env.EXA_API_KEY : process.env.CONTEXT_DEV_API_KEY;
if (!key) throw new Error(`${api} key missing`);
const headers = isExa
	? { 'x-api-key': key, 'content-type': 'application/json' }
	: { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
const t0 = Date.now();
const res = await fetch(base + path, {
	method: body && body !== '-' ? 'POST' : 'GET',
	headers,
	body: body && body !== '-' ? body : undefined
});
const text = await res.text();
console.error(
	`[spike] ${api} ${path} ${res.status} ${Date.now() - t0}ms credits=${res.headers.get('x-credits-used') ?? '-'}`
);
process.stdout.write(text);
