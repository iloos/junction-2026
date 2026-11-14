#!/usr/bin/env node
/**
 * One command for the playtest: runs the journeys, then indexes the run.
 *   node evals/playtest/run.mjs                                  # local fixture preview on 5190
 *   KITCHEN_URL=https://app.mandate.kitchen node evals/playtest/run.mjs   # a deploy
 *   node evals/playtest/run.mjs --grep m1                        # some journeys only
 * Writes scratch/playtest/<UTC time>-<commit>/ with per-viewport journey folders, steps.json and RUN.md, and links
 * the previous run in RUN.md so the judge pass can diff. The judge pass itself is the `playtest` skill.
 */
import { spawnSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const base = process.env.KITCHEN_URL ?? 'http://localhost:5190';
let commit = 'local';
try {
	if (process.env.KITCHEN_URL) {
		const h = await (await fetch(`${base}/healthz`)).json();
		commit = String(h.commit ?? 'unknown').slice(0, 7);
	} else commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
} catch {
	/* unknown commit: the run still goes */
}
const target = process.env.KITCHEN_URL ? new URL(base).host : 'local-fixture';
const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
const runs = join(root, 'scratch', 'playtest');
mkdirSync(runs, { recursive: true });
const previous = readdirSync(runs)
	.filter((d) => statSync(join(runs, d)).isDirectory() && existsSync(join(runs, d, 'steps.json')))
	.sort()
	.at(-1);
const dir = join(runs, `${stamp}-${target}-${commit}`);
mkdirSync(dir, { recursive: true });

const t0 = Date.now();
const res = spawnSync(
	process.execPath,
	[
		join('node_modules', '@playwright', 'test', 'cli.js'),
		'test',
		'-c',
		'evals/playtest/pw.config.ts',
		...process.argv.slice(2)
	],
	{ stdio: 'inherit', env: { ...process.env, PLAYTEST_DIR: dir } }
);

const journeys = [];
for (const vp of readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory()))
	for (const id of readdirSync(join(dir, vp))) {
		const f = join(dir, vp, id, 'journey.json');
		if (existsSync(f)) journeys.push(JSON.parse(readFileSync(f, 'utf-8')));
	}
journeys.sort((a, b) => `${a.id}${a.viewport}`.localeCompare(`${b.id}${b.viewport}`));
const steps = journeys.flatMap((j) =>
	j.steps.map((s) => ({ key: `${j.id}/${j.viewport}/${s.step}`, ok: s.ok, error: s.error ?? null }))
);
writeFileSync(join(dir, 'steps.json'), JSON.stringify({ base, commit, steps }, null, '\t'));

let diff = '';
if (previous) {
	const prev = new Map(
		JSON.parse(readFileSync(join(runs, previous, 'steps.json'), 'utf-8')).steps.map((s) => [
			s.key,
			s.ok
		])
	);
	const fixed = steps.filter((s) => s.ok && prev.get(s.key) === false).map((s) => s.key);
	const regressed = steps.filter((s) => !s.ok && prev.get(s.key) === true).map((s) => s.key);
	diff = `\n## Against ${previous}\n- now unstuck: ${fixed.join(', ') || 'none'}\n- newly stuck: ${regressed.join(', ') || 'none'}\n`;
}

const lines = journeys.map((j) => {
	const stuck = j.steps.filter((s) => !s.ok);
	return `| ${j.id} | ${j.viewport} | ${j.title} | ${j.steps.length - stuck.length}/${j.steps.length} | ${stuck.map((s) => `${s.step}: ${s.error?.slice(0, 120)}${s.beat ? ` (${s.beat})` : ''}`).join('<br>') || ''} |`;
});
writeFileSync(
	join(dir, 'RUN.md'),
	`# Playtest ${stamp}\n\nTarget ${base} · commit ${commit} · ${Math.round((Date.now() - t0) / 1000)} s · playwright exit ${res.status}\n\n| journey | viewport | title | steps ok | stuck at |\n|---|---|---|---|---|\n${lines.join('\n')}\n${diff}\nBeats: \`<viewport>/<journey>/NN-<step>.png\` (full page), \`.fold.png\` (first screen), \`.txt\` (DOM text). Chat turns, request ids, receipts and notes in each \`journey.json\`. Judge with the \`playtest\` skill; findings go to \`FINDINGS.md\` here.\n`
);
console.log(
	`\nplaytest: ${dir}\n${steps.filter((s) => !s.ok).length} stuck steps of ${steps.length}`
);
