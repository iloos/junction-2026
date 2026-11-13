// Eval runner: plays evals/scenarios/*.json through a gate adapter and checks the end state.
//   node evals/run.ts                 validate scenario files (no adapter yet)
//   node evals/run.ts --adapter fixture [--only s3] [--json]
// Exit code 1 if any check fails. Node ≥ 23.6 runs this TypeScript directly (type stripping).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkExpect, KNOWN_KEYS } from './check.ts';
import type { CheckResult, EndState, Scenario, Step } from './types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEEDS = join(HERE, '..', 'fixtures', 'seeds');

/** What an adapter must provide: a fresh store per scenario, steps through the real gate, then the end state. */
export interface Gate {
	reset(scenario: Scenario, seeds: Seeds): Promise<void>;
	step(step: Step, index: number): Promise<void>;
	endState(): Promise<EndState>;
}
export type GateFactory = () => Promise<Gate>;

export interface Seeds {
	kitchens: { kitchens: { id: string }[] };
	events: Record<string, { id: string }>;
	calendar: unknown;
}

// Adapters register here once the contracts exist (e.g. fixture = tool registry over the PGlite fixture store).
const ADAPTERS: Record<string, GateFactory> = {};

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

/** Static checks that need no adapter: seeds resolve, every expect key has a checker. */
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

export async function runScenario(
	s: Scenario,
	seeds: Seeds,
	make: GateFactory
): Promise<CheckResult[]> {
	const gate = await make();
	await gate.reset(s, seeds);
	for (const [i, step] of s.steps.entries()) await gate.step(step, i);
	return checkExpect(s.expect, await gate.endState());
}

async function main() {
	const args = process.argv.slice(2);
	const opt = (name: string) => {
		const i = args.indexOf(name);
		return i >= 0 ? args[i + 1] : undefined;
	};
	const adapter = opt('--adapter');
	const scenarios = loadScenarios(opt('--only'));
	const seeds = loadSeeds();
	if (adapter && !ADAPTERS[adapter]) {
		console.error(
			`unknown adapter "${adapter}"; known: ${Object.keys(ADAPTERS).join(', ') || 'none yet'}`
		);
		process.exit(2);
	}
	const report: { id: string; results: CheckResult[] }[] = [];
	for (const s of scenarios) {
		const results = adapter ? await runScenario(s, seeds, ADAPTERS[adapter]) : validate(s, seeds);
		report.push({ id: s.id, results });
	}
	if (args.includes('--json')) console.log(JSON.stringify(report, null, 1));
	else
		for (const { id, results } of report) {
			const failed = results.filter((r) => !r.pass);
			console.log(
				`${failed.length ? '✗' : '✓'} ${id}  ${results.length - failed.length}/${results.length}`
			);
			for (const r of failed) console.log(`    ✗ ${r.key}: ${r.detail}`);
		}
	if (!adapter)
		console.log('\n(no adapter: validated scenario files only; pass --adapter <name> to run them)');
	process.exit(report.some((r) => r.results.some((x) => !x.pass)) ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
