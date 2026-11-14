// Grounded menu checks: each proposed dish is compared with sourced recipes (Exa, via make-in-house), so the chef sees
// which ingredients a published recipe supports and which the model added. Pure; the driver
// (src/lib/server/evals/menu-grounding.test.ts) observes the app. Node runs this file directly.
import type { CheckResult } from '../types.ts';

/** The menu as proposed: dish and ingredient ids, which are stable across revisions. */
export interface MenuShape {
	dishes: { id: string; name: string; ingredients: { id: string; label: string }[] }[];
}

/** One dish's grounding, as the server returns it (contract for `groundMenu` in src/lib/server/menu/grounding.ts). */
export type DishGrounding =
	| {
			status: 'sourced';
			/** The recipes the comparison used, each a cited web page. */
			recipes: { title: string; url: string; host: string }[];
			/** Every proposal ingredient id → whether a cited recipe has it. */
			ingredients: Record<string, 'sourced' | 'unsourced'>;
			/** Ingredients the sources use that the proposal lacks, in the sources' words. */
			missing: string[];
	  }
	| { status: 'none'; reason: string };

export interface MenuGrounding {
	/** dish id → grounding. */
	dishes: Record<string, DishGrounding>;
}

const hostOf = (url: string) => {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return null;
	}
};

/**
 * Every dish is grounded or says why not; a sourced dish cites real pages and classifies each of its ingredients;
 * nothing is invented (no unknown ids), and grounding never changes the menu (same digest before and after).
 */
export function checkGrounding(
	key: string,
	menu: MenuShape,
	g: MenuGrounding,
	digests?: { before: string; after: string }
): CheckResult[] {
	const out: CheckResult[] = [];
	const add = (k: string, pass: boolean, detail: string) =>
		out.push({ key: `${key}.${k}`, pass, detail });
	for (const d of menu.dishes) {
		const x = g.dishes[d.id];
		if (!x) {
			add(`${d.id}.present`, false, `${d.name}: no grounding (a dish is never silently skipped)`);
			continue;
		}
		if (x.status === 'none') {
			add(
				`${d.id}.reason`,
				x.reason.trim().length > 0,
				`${d.name}: no source, reason "${x.reason}"`
			);
			continue;
		}
		const cited = x.recipes.filter((r) => {
			const h = hostOf(r.url);
			return h !== null && /^https?:/.test(r.url) && h === r.host.replace(/^www\./, '');
		});
		add(
			`${d.id}.cited`,
			x.recipes.length > 0 && cited.length === x.recipes.length,
			`${d.name}: ${cited.length}/${x.recipes.length} recipes with a matching http(s) url and host`
		);
		const ids = new Set(d.ingredients.map((i) => i.id));
		const unclassified = d.ingredients.filter((i) => !(i.id in x.ingredients)).map((i) => i.label);
		const unknown = Object.keys(x.ingredients).filter((id) => !ids.has(id));
		add(
			`${d.id}.classified`,
			unclassified.length === 0 && unknown.length === 0,
			unclassified.length || unknown.length
				? `unclassified ${unclassified.join(', ') || '-'}; ids not in the dish ${unknown.join(', ') || '-'}`
				: `${d.ingredients.length} ingredients, ${Object.values(x.ingredients).filter((v) => v === 'unsourced').length} unsourced, ${x.missing.length} missing`
		);
	}
	const extra = Object.keys(g.dishes).filter((id) => !menu.dishes.some((d) => d.id === id));
	add(
		'noExtraDishes',
		extra.length === 0,
		extra.length ? `grounding for unknown dishes ${extra}` : 'ok'
	);
	if (digests)
		add(
			'menuUnchanged',
			digests.before === digests.after,
			`proposal digest ${digests.before.slice(0, 8)} → ${digests.after.slice(0, 8)}`
		);
	return out;
}
