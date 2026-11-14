import { test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The playtest records what a first-time visitor sees; it does not assert. Each journey is a list of steps; a step that
 * throws is written down as where the visitor got stuck and the journey goes on (or stops, when later steps need it).
 * Judges read the run directory afterwards: per viewport and journey, `NN-<beat>.png` + `.txt` (DOM text), and
 * `journey.json` with every step's outcome, the request ids seen, chat turns and receipts.
 */
export const BASE = process.env.KITCHEN_URL ?? 'http://localhost:5190';
export const RUN_DIR = process.env.PLAYTEST_DIR ?? join('scratch', 'playtest', 'adhoc');

type Step = { step: string; ok: boolean; ms: number; error?: string; beat?: string };
export type Journey = {
	id: string;
	title: string;
	viewport: string;
	steps: Step[];
	requestIds: string[];
	chat: { said: string; reply: string }[];
	receipts: string[];
	notes: Record<string, unknown>;
};

export class Recorder {
	readonly dir: string;
	readonly j: Journey;
	private n = 0;
	constructor(
		readonly page: Page,
		info: TestInfo,
		id: string,
		title: string
	) {
		const viewport = info.project.name;
		this.dir = join(RUN_DIR, viewport, id);
		mkdirSync(this.dir, { recursive: true });
		this.j = {
			id,
			title,
			viewport,
			steps: [],
			requestIds: [],
			chat: [],
			receipts: [],
			notes: {}
		};
		page.on('response', (r) => {
			const rid = r.headers()['x-request-id'];
			if (rid && !this.j.requestIds.includes(rid)) this.j.requestIds.push(rid);
		});
		page.on('pageerror', (e) =>
			appendFileSync(join(this.dir, 'console.txt'), `pageerror ${e.message}\n`)
		);
		page.on('console', (m) => {
			if (m.type() === 'error')
				appendFileSync(join(this.dir, 'console.txt'), `console.error ${m.text()}\n`);
		});
	}

	/** Screenshot (full page) and the visible text, numbered in order. */
	async beat(name: string): Promise<string> {
		const file = `${String(++this.n).padStart(2, '0')}-${name}`;
		await this.page
			.screenshot({ path: join(this.dir, `${file}.png`), fullPage: true })
			.catch(() => {});
		await this.page
			.screenshot({ path: join(this.dir, `${file}.fold.png`), fullPage: false })
			.catch(() => {});
		const text = await this.page
			.locator('body')
			.innerText()
			.catch(() => '');
		writeFileSync(
			join(this.dir, `${file}.txt`),
			`${new Date().toISOString()} ${this.page.url()}\n${text}`
		);
		return file;
	}

	/** Runs one step; a throw is recorded with a beat of the screen at that moment. Returns whether it worked. */
	async step(
		name: string,
		fn: () => Promise<void>,
		opts: { beat?: boolean } = {}
	): Promise<boolean> {
		const t = Date.now();
		try {
			await fn();
			const beat = opts.beat === false ? undefined : await this.beat(slug(name));
			this.j.steps.push({ step: name, ok: true, ms: Date.now() - t, beat });
			return true;
		} catch (e) {
			const beat = await this.beat(`STUCK-${slug(name)}`);
			const error = (e instanceof Error ? e.message : String(e)).split('\n').slice(0, 4).join(' ');
			this.j.steps.push({ step: name, ok: false, ms: Date.now() - t, error, beat });
			return false;
		}
	}

	note(key: string, value: unknown) {
		this.j.notes[key] = value;
	}

	save() {
		writeFileSync(join(this.dir, 'journey.json'), JSON.stringify(this.j, null, '\t'));
	}
}

const slug = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 48);

/** One journey per test: the recorder is saved however the test ends. */
export function journey(
	id: string,
	title: string,
	body: (r: Recorder, page: Page) => Promise<void>,
	timeout = 240_000
) {
	test(`${id} ${title}`, async ({ page }, info) => {
		test.setTimeout(timeout);
		const r = new Recorder(page, info, id, title);
		try {
			await body(r, page);
		} finally {
			r.save();
		}
	});
}

export const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 600;
