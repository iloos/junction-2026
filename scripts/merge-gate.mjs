// Merge gate: every step must be green before the lead merges a lane into main.
// Runs in order and stops on the first red. Usage (from the checkout being merged):
//   node scripts/merge-gate.mjs            all steps
//   node scripts/merge-gate.mjs --from eval   resume at a step after fixing a red one
//   node scripts/merge-gate.mjs --only lint,eval
// No network: LLM_PROVIDER is forced to fixture so a gate run never spends or flakes on an API.
import { spawnSync } from 'node:child_process';

const STEPS = [
	{ name: 'check', cmd: ['pnpm', 'check'] },
	{ name: 'lint', cmd: ['pnpm', 'lint'] },
	{ name: 'evals:self', cmd: ['node', '--test', 'evals/check.test.ts'] },
	// PGlite under load times out now and then: a red test:unit is rerun once and reported as flaky if it passes.
	{ name: 'test:unit', cmd: ['pnpm', 'test:unit', '--run'], retry: 1 },
	{ name: 'eval', cmd: ['pnpm', 'eval'] },
	{ name: 'eval:agent', cmd: ['pnpm', 'eval:agent'] }
];

const args = process.argv.slice(2);
const flag = (k) => {
	const i = args.indexOf(k);
	return i >= 0 ? args[i + 1] : undefined;
};
const names = STEPS.map((s) => s.name);
const from = flag('--from');
const only = flag('--only')?.split(',');
for (const n of [from, ...(only ?? [])].filter(Boolean)) {
	if (!names.includes(n)) {
		console.error(`merge-gate: unknown step "${n}"; steps are ${names.join(', ')}`);
		process.exit(2);
	}
}
const steps = STEPS.filter((s, i) =>
	only ? only.includes(s.name) : from ? i >= names.indexOf(from) : true
);

const env = { ...process.env, LLM_PROVIDER: 'fixture', CI: '1', FORCE_COLOR: '1' };
const results = [];
for (const s of steps) {
	console.log(`\n=== merge-gate: ${s.name} (${s.cmd.join(' ')}) ===`);
	const t0 = Date.now();
	const run = () => spawnSync(s.cmd.join(' '), { stdio: 'inherit', shell: true, env }).status === 0;
	let ok = run();
	let flaky = false;
	for (let n = 0; !ok && n < (s.retry ?? 0); n++) {
		console.log(`\n=== merge-gate: ${s.name} red, retrying once (known PGlite timeouts) ===`);
		ok = flaky = run();
	}
	const secs = ((Date.now() - t0) / 1000).toFixed(1);
	results.push(`${ok ? (flaky ? 'FLAKY' : 'PASS') : 'FAIL'}  ${s.name.padEnd(11)} ${secs}s`);
	if (!ok) {
		console.log(`\n${results.join('\n')}\nmerge-gate: RED at ${s.name}; do not merge.`);
		console.log(`Resume after fixing: node scripts/merge-gate.mjs --from ${s.name}`);
		process.exit(1);
	}
}
console.log(`\n${results.join('\n')}\nmerge-gate: GREEN (${steps.length} steps)`);
