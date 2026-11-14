// Grounded menu checks: each proposed dish's model-written ingredients compared with cited web recipes (Exa, through
// the make-in-house path; src/lib/server/web/grounding.ts), so the chef sees which sources match and what the model
// added or left out. Pure; the driver (src/lib/server/evals/menu-grounding.test.ts) observes the app. Node runs this
// file directly, so the types mirror web/grounding.ts instead of importing it.
import type { CheckResult } from '../types.ts';

/** The menu as proposed. */
export interface MenuShape {
	dishes: { id: string; name: string; ingredients: { id: string; label: string }[] }[];
}

/** `GroundingState` from web/grounding.ts. */
export type GroundingState =
	| {
			dishName: string;
			state: 'done';
			source: string;
			matchedSources: { url: string; title: string; host: string; shared: number; of: number }[];
			compared: { url: string; title: string; host: string }[];
			modelOnly: string[];
			sourceOnly: string[];
			note: string;
	  }
	| { dishName: string; state: 'pending' }
	| { dishName: string; state: 'failed'; error: string };

/** Share of the model's ingredients a source must use to count as matching (MATCH_SHARE in web/grounding.ts). */
export const MATCH_SHARE = 0.5;

const hostOf = (url: string) => {
	try {
		const u = new URL(url);
		return /^https?:$/.test(u.protocol) ? u.host.replace(/^www\./, '') : null;
	} catch {
		return null;
	}
};

/**
 * Every dish is grounded (`done`) with a note; every recipe compared is a real http(s) page whose host is its url's;
 * a matched source is one of those compared and really shares at least half of the dish's ingredients; `modelOnly`
 * names only the dish's own ingredients; a dish with no recipe says so; grounding never changes the menu.
 */
export function checkGrounding(
	key: string,
	menu: MenuShape,
	g: Record<string, GroundingState>,
	digests?: { before: string; after: string }
): CheckResult[] {
	const out: CheckResult[] = [];
	const add = (k: string, pass: boolean, detail: string) =>
		out.push({ key: `${key}.${k}`, pass, detail });
	for (const d of menu.dishes) {
		const x = g[d.name];
		if (!x || x.state !== 'done') {
			add(
				`${d.id}.done`,
				false,
				`${d.name}: ${!x ? 'no grounding (a dish is never silently skipped)' : x.state === 'failed' ? `failed: ${x.error}` : 'still pending'}`
			);
			continue;
		}
		add(`${d.id}.note`, x.note.trim().length > 0, `${d.name}: "${x.note}"`);
		const badHost = x.compared.filter((c) => hostOf(c.url) !== c.host.replace(/^www\./, ''));
		add(
			`${d.id}.cited`,
			badHost.length === 0,
			badHost.length
				? `recipes whose host is not their url's: ${badHost.map((c) => `${c.host} ≠ ${c.url}`).join('; ')}`
				: `${x.compared.length} recipes compared (${x.compared.map((c) => c.host).join(', ') || 'none'})`
		);
		const n = d.ingredients.length;
		const badMatch = x.matchedSources.filter(
			(m) =>
				!x.compared.some((c) => c.url === m.url) ||
				m.of !== n ||
				m.shared > m.of ||
				m.shared / m.of < MATCH_SHARE
		);
		add(
			`${d.id}.matched`,
			badMatch.length === 0,
			badMatch.length
				? `matches that aren't compared recipes sharing ≥ ${MATCH_SHARE} of ${n}: ${badMatch.map((m) => `${m.host} ${m.shared}/${m.of}`).join('; ')}`
				: `${x.matchedSources.length} matched`
		);
		const labels = new Set(d.ingredients.map((i) => i.label));
		const foreign = x.modelOnly.filter((l) => !labels.has(l));
		add(
			`${d.id}.modelOnly`,
			foreign.length === 0 && (x.compared.length > 0 || x.modelOnly.length === 0),
			foreign.length
				? `modelOnly names what the dish doesn't have: ${foreign.join(', ')}`
				: `${x.modelOnly.length} model-only, ${x.sourceOnly.length} source-only`
		);
	}
	const names = new Set(menu.dishes.map((d) => d.name));
	const extra = Object.keys(g).filter((n) => !names.has(n));
	add(
		'noExtraDishes',
		extra.length === 0,
		extra.length ? `grounding for dishes not on the menu: ${extra.join(', ')}` : 'ok'
	);
	if (digests)
		add(
			'menuUnchanged',
			digests.before === digests.after,
			digests.before === digests.after
				? 'proposal unchanged'
				: 'grounding changed the stored proposal'
		);
	return out;
}
