// Merge gate: every step must be green before the lead merges a lane into main.
// Runs in order and stops on the first red. Usage (from the checkout being merged):
//   node scripts/merge-gate.mjs            all steps
//   node scripts/merge-gate.mjs --from eval   resume at a step after fixing a red one
//   node scripts/merge-gate.mjs --only lint,eval
//   node scripts/merge-gate.mjs --full          also the Playwright e2e specs (before a tag)
// No network: LLM_PROVIDER is forced to fixture so a gate run never spends or flakes on an API.
// The test steps hold a machine-wide lock: parallel gates in several worktrees starve PGlite of memory.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const STEPS = [
	{ name: 'check', cmd: ['pnpm', 'check'] },
	{ name: 'lint', cmd: ['pnpm', 'lint'] },
	{
		name: 'evals:self',
		cmd: [
			'node',
			'--test',
			'evals/check.test.ts',
			'evals/chat/check.test.ts',
			'evals/chat/free-check.test.ts',
			'evals/menu/grounding-check.test.ts'
		]
	},
	// check passes on code that still fails to bundle (adapter-node, SSR imports): build it.
	{ name: 'build', cmd: ['pnpm', 'build'], heavy: true },
	// PGlite under load times out now and then: a red test:unit is rerun once and reported as flaky if it passes.
	{ name: 'test:unit', cmd: ['pnpm', 'test:unit', '--run'], retry: 1, heavy: true },
	{ name: 'eval', cmd: ['pnpm', 'eval'], heavy: true },
	{ name: 'eval:agent', cmd: ['pnpm', 'eval:agent'], heavy: true },
	// --full only: Playwright builds and previews the app itself (playwright.config.ts). Preview reads the worktree's
	// .env, so DATABASE_URL is blanked (PGlite, never Aiven) and judge keys get a throwaway secret.
	{
		name: 'e2e',
		cmd: [
			'pnpm',
			'exec',
			'playwright',
			'install',
			'chromium',
			'&&',
			'pnpm',
			'exec',
			'playwright',
			'test'
		],
		heavy: true,
		full: true,
		env: { DATABASE_URL: '', JUDGE_KEY_SECRET: randomBytes(32).toString('base64url') }
	}
];

const args = process.argv.slice(2);
const flag = (k) => {
	const i = args.indexOf(k);
	return i >= 0 ? args[i + 1] : undefined;
};
const names = STEPS.map((s) => s.name);
const from = flag('--from');
const only = flag('--only')?.split(',');
const full = args.includes('--full');
for (const n of [from, ...(only ?? [])].filter(Boolean)) {
	if (!names.includes(n)) {
		console.error(`merge-gate: unknown step "${n}"; steps are ${names.join(', ')}`);
		process.exit(2);
	}
}
const steps = STEPS.filter((s, i) =>
	only ? only.includes(s.name) : (full || !s.full) && (from ? i >= names.indexOf(from) : true)
);

// --- machine-wide lock for the test steps -------------------------------------------------------
const LOCK = join(tmpdir(), 'junc26-merge-gate.lock');
const STALE_MS = 45 * 60_000;
let holding = false;

const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e.code === 'EPERM';
	}
};
const readLock = () => {
	try {
		return JSON.parse(readFileSync(LOCK, 'utf-8'));
	} catch {
		return null;
	}
};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// The main checkout's gate decides merges: while it waits, lane gates let it take the lock next.
const PRIORITY = join(tmpdir(), 'junc26-merge-gate.priority');
const isMain = (() => {
	try {
		const r = (a) => execFileSync('git', ['rev-parse', a], { encoding: 'utf-8' }).trim();
		return resolve(r('--git-dir')) === resolve(r('--git-common-dir'));
	} catch {
		return false;
	}
})();
const mainWaiting = () => {
	try {
		const pid = Number(readFileSync(PRIORITY, 'utf-8'));
		return pid !== process.pid && alive(pid);
	} catch {
		return false;
	}
};

function acquireLock() {
	let announced = 0;
	if (isMain) writeFileSync(PRIORITY, String(process.pid));
	for (;;) {
		if (!isMain && mainWaiting()) {
			if (Date.now() - announced > 60_000) {
				console.log('merge-gate: main checkout is waiting for the gate lock; letting it go first');
				announced = Date.now();
			}
			sleep(2000);
			continue;
		}
		try {
			const fd = openSync(LOCK, 'wx');
			writeSync(
				fd,
				JSON.stringify({ pid: process.pid, worktree: process.cwd(), at: new Date().toISOString() })
			);
			closeSync(fd);
			holding = true;
			if (isMain) rmSync(PRIORITY, { force: true });
			return;
		} catch (e) {
			if (e.code !== 'EEXIST') throw e;
		}
		const held = readLock();
		const stale = !held || !alive(held.pid) || Date.now() - Date.parse(held.at ?? 0) > STALE_MS;
		if (stale) {
			console.log(`merge-gate: removing stale gate lock ${held ? `(pid ${held.pid})` : ''}`);
			rmSync(LOCK, { force: true });
			continue;
		}
		if (Date.now() - announced > 60_000) {
			console.log(`merge-gate: waiting for gate lock held by ${held.worktree} (pid ${held.pid})`);
			announced = Date.now();
		}
		sleep(2000);
	}
}
function releaseLock() {
	if (holding && readLock()?.pid === process.pid) rmSync(LOCK, { force: true });
	try {
		if (Number(readFileSync(PRIORITY, 'utf-8')) === process.pid) rmSync(PRIORITY, { force: true });
	} catch {
		// no priority claim
	}
	holding = false;
}
process.on('exit', releaseLock);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'])
	process.on(sig, () => {
		releaseLock();
		process.exit(130);
	});

// --- steps ----------------------------------------------------------------------------------------
const env = { ...process.env, LLM_PROVIDER: 'fixture', CI: '1', FORCE_COLOR: '1' };
const results = [];
for (const s of steps) {
	if (s.heavy && !holding) acquireLock();
	console.log(`\n=== merge-gate: ${s.name} (${s.cmd.join(' ')}) ===`);
	const t0 = Date.now();
	const run = () =>
		spawnSync(s.cmd.join(' '), { stdio: 'inherit', shell: true, env: { ...env, ...s.env } })
			.status === 0;
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
