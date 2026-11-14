// Static validation of the scenario files: every seed resolves and every expect key has a checker. Playing a scenario
// happens in src/lib/server/evals (pnpm eval); this file needs no app code.
//   node evals/run.ts [--only s3] [--json]
// Exit code 1 if any file fails. Node ≥ 23.6 runs this TypeScript directly (type stripping).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_KEYS } from './check.ts';
import type { CheckResult, Scenario } from './types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEEDS = join(HERE, '..', 'fixtures', 'seeds');

export interface Seeds {
	kitchens: { kitchens: { id: string }[] };
	events: Record<string, { id: string }>;
	calendar: unknown;
}

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));

export function loadScenarios(only?: string): Scenario[] {
	const dir = join(HERE, 'scenarios');
	return readdirSync(dir)
		.filter((f) => f.endsWith('.json') && (!only || f.startsWith(only)))
		.sort()
		.map((f) => readJson(join(dir, f)) as Scenario);
}

export function loadSeeds(): Seeds {
	const buffet = readJson(join(SEEDS, 'christmas-buffet-140.json'));
	return {
		kitchens: readJson(join(SEEDS, 'kitchens.json')),
		events: { [buffet.id]: buffet },
		calendar: readJson(join(SEEDS, 'calendar-factors.json'))
	};
}

/** Checks that need no app: seeds resolve, every expect key has a checker. */
export function validate(s: Scenario, seeds: Seeds): CheckResult[] {
	const out: CheckResult[] = [];
	const kitchen = seeds.kitchens.kitchens.some((k) => k.id === s.seeds.kitchen);
	out.push({ key: 'seeds.kitchen', pass: kitchen, detail: s.seeds.kitchen });
	if (s.seeds.event)
		out.push({
			key: 'seeds.event',
			pass: Boolean(seeds.events[s.seeds.event]),
			detail: s.seeds.event
		});
	for (const k of Object.keys(s.expect))
		out.push({
			key: `expect.${k}`,
			pass: KNOWN_KEYS.includes(k),
			detail: KNOWN_KEYS.includes(k) ? 'checker' : 'no checker'
		});
	return out;
}

function main() {
	const args = process.argv.slice(2);
	const i = args.indexOf('--only');
	const seeds = loadSeeds();
	const report = loadScenarios(i >= 0 ? args[i + 1] : undefined).map((s) => ({
		id: s.id,
		results: validate(s, seeds)
	}));
	if (args.includes('--json')) console.log(JSON.stringify(report, null, 1));
	else
		for (const { id, results } of report) {
			const failed = results.filter((r) => !r.pass);
			console.log(
				`${failed.length ? '✗' : '✓'} ${id}  ${results.length - failed.length}/${results.length}`
			);
			for (const r of failed) console.log(`    ✗ ${r.key}: ${r.detail}`);
		}
	process.exit(report.some((r) => r.results.some((x) => !x.pass)) ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
