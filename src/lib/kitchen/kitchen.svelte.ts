/* eslint-disable svelte/prefer-svelte-reactivity -- Maps and Sets here are built fresh and replaced wholesale ($state.raw), never mutated after. */
import type { DomainError, Line } from '$lib/core/contracts';
import { apiMode, ToolError, call, type ApiMode } from './api';
import type { PresetId } from './fixture-plan';
import {
	setContention as fxContention,
	setKitchen as fxKitchen,
	setPreset as fxPreset,
	reset as fxReset,
	snapshot,
	type Snapshot as FixtureSnapshot
} from './backend';

export interface ActivityItem {
	id: number;
	text: string;
	kind: 'edit' | 'rules' | 'approval' | 'commit' | 'retry' | 'error' | 'sim';
	version: number;
}

export interface CommitNote {
	key: string;
	orderId: string;
	receiptId: string;
	totalCents: number;
	lines: number;
	awaiting: number;
	replayed: boolean;
}

/**
 * Client state for the kitchen screen. The snapshot is replaced wholesale after every call
 * ($state.raw, never mutated), so the table re-renders from one consistent plan version.
 */
export class KitchenStore {
	snap = $state.raw<FixtureSnapshot | null>(null);
	busy = $state(false);
	error = $state.raw<DomainError | null>(null);
	activity = $state.raw<ActivityItem[]>([]);
	/** Line ids that changed in the last update, for the row flash. */
	flash = $state.raw<Set<string>>(new Set());
	whyLineId = $state<string | null>(null);
	whySteps = $state.raw<{ text: string; source: string; detail?: string }[]>([]);
	lastCommit = $state.raw<CommitNote | null>(null);
	/** Live unless the server can't be reached (then the labelled offline fixture). */
	mode = $state<ApiMode>(apiMode());
	/** Scenario "now" (Helsinki story time), ticking. */
	now = $state.raw<Date | null>(null);
	/** Plan version when this screen first saw the run: older voided approvals are history, not news. */
	firstVersion = $state<number | null>(null);
	runId = $state<string | null>(null);
	#clockBase: { scenarioMs: number; wallMs: number } | null = null;
	#seq = 0;
	#flashTimer: ReturnType<typeof setTimeout> | undefined;

	plan = $derived(this.snap?.plan ?? null);
	view = $derived(this.snap?.view ?? null);

	lineById = $derived.by(() => {
		const m = new Map<string, Line>();
		for (const l of this.snap?.plan.lines ?? []) m.set(l.id, l);
		return m;
	});

	async load() {
		await this.#run(async () => {
			await call('plan_event', {
				kitchenId: this.snap?.kitchen.id ?? 'k-hotel',
				eventId: 'event-xmas-140'
			});
		});
	}

	async setGrams(dishId: string, grams: number) {
		const dish = this.view?.dishes.find((d) => d.id === dishId);
		if (!dish || !this.plan || grams === dish.gServed) return;
		await this.#run(async () => {
			await call('edit_line', {
				planId: this.plan!.id,
				version: this.plan!.version,
				needId: dish.needId,
				patch: { gramsPerGuest: grams }
			});
			this.#log('edit', `${dish.nameFi}: ${dish.gServed} → ${grams} g per guest`);
		});
	}

	async setPreset(preset: PresetId) {
		if (this.snap?.preset === preset) return;
		await this.#run(async () => {
			await fxPreset(preset);
			this.#log(
				'rules',
				`Rules: ${preset === 'kitchen' ? 'kitchen default' : preset === 'price' ? 'price first' : 'Finnish required'}`
			);
		});
	}

	async setKitchen(kitchenId: string) {
		await this.#run(async () => {
			await fxKitchen(kitchenId);
			this.lastCommit = null;
			this.#log('rules', `Kitchen: ${kitchenId}`);
		});
	}

	async setContention(on: boolean) {
		await this.#run(async () => {
			await fxContention(on);
			this.#log(
				'sim',
				on
					? 'Simulator: another kitchen took 4 × palvikinkku 476768'
					: 'Simulator: contention cleared'
			);
		});
	}

	async reset() {
		await this.#run(async () => {
			await fxReset();
			this.lastCommit = null;
			this.activity = [];
		});
	}

	async approve(decision: 'grant' | 'deny' = 'grant') {
		const a = this.snap?.approval;
		if (!a) return;
		await this.#run(async () => {
			const out = await call('approve', {
				approvalId: a.id,
				planVersion: a.planVersion,
				termsHash: a.termsHash,
				decision
			});
			this.#log(
				'approval',
				`${a.id} ${out.state}: ${a.lineIds.length} lines, bound to v${a.planVersion} · ${a.termsHash.slice(0, 8)}`
			);
		});
	}

	async commit() {
		if (!this.plan) return;
		const key = `commit-${this.plan.id}-v${this.plan.version}`;
		await this.#commitWith(key, false);
	}

	/** Deliberately resend the last commit with the same idempotency key. */
	async retryCommit() {
		if (!this.lastCommit || !this.plan) return;
		await this.#commitWith(this.lastCommit.key, true);
	}

	async #commitWith(key: string, replay: boolean) {
		await this.#run(async () => {
			const out = await call('commit_order', {
				planId: this.plan!.id,
				version: this.plan!.version,
				idempotencyKey: key
			});
			this.lastCommit = {
				key,
				orderId: out.orderId,
				receiptId: out.receiptId,
				totalCents: out.totalCents,
				lines: out.committedLineIds.length,
				awaiting: out.awaitingSupplier.length,
				replayed: replay
			};
			this.#log(
				replay ? 'retry' : 'commit',
				replay
					? `Retry with key ${key}: same receipt ${out.receiptId}, no second order`
					: `${out.orderId} committed: ${out.committedLineIds.length} lines, receipt ${out.receiptId}`
			);
		});
	}

	async openWhy(lineId: string) {
		if (!this.plan) return;
		try {
			const out = await call('explain_line', { planId: this.plan.id, lineId });
			this.whySteps = out.steps;
			this.whyLineId = lineId;
		} catch (e) {
			if (e instanceof ToolError) this.error = e.error;
			else throw e;
		}
	}

	closeWhy() {
		this.whyLineId = null;
	}

	async #run(fn: () => Promise<void>) {
		this.busy = true;
		this.error = null;
		const before = this.snap?.plan.lines ?? [];
		try {
			await fn();
		} catch (e) {
			this.#fail(e);
		}
		try {
			const next = await snapshot();
			this.snap = next;
			this.#clockAt(next);
			this.mode = apiMode();
			this.#flashChanges(before, next.plan.lines);
		} catch (e) {
			// Keep showing the last server state; never substitute fixture data for a failed server read.
			this.#fail(e);
		} finally {
			this.busy = false;
		}
	}

	#fail(e: unknown) {
		if (e instanceof ToolError) {
			this.error = e.error;
			this.#log('error', `${e.error.code}: ${e.error.message}`);
		} else {
			const message = e instanceof Error ? e.message : String(e);
			this.error = { code: 'PROVIDER_UNAVAILABLE', message, retryable: true };
			this.#log('error', message);
		}
	}

	/** The scenario clock: the server's reading at snapshot time, then advanced by the wall clock. */
	#clockAt(s: FixtureSnapshot) {
		if (!s.clock) return;
		this.#clockBase = { scenarioMs: new Date(s.clock.nowIso).getTime(), wallMs: Date.now() };
		if (this.firstVersion === null || s.clock.runId !== this.runId)
			this.firstVersion = s.plan.version;
		this.runId = s.clock.runId;
		this.tick();
	}

	tick() {
		if (this.#clockBase)
			this.now = new Date(this.#clockBase.scenarioMs + (Date.now() - this.#clockBase.wallMs));
	}

	#flashChanges(before: Line[], after: Line[]) {
		if (!before.length) return;
		const prev = new Map(before.map((l) => [l.id, l]));
		const changed = new Set<string>();
		for (const l of after) {
			const p = prev.get(l.id);
			if (
				!p ||
				p.qty.value !== l.qty.value ||
				p.state !== l.state ||
				p.tier !== l.tier ||
				p.lineCents !== l.lineCents
			)
				changed.add(l.id);
		}
		this.flash = changed;
		clearTimeout(this.#flashTimer);
		this.#flashTimer = setTimeout(() => (this.flash = new Set()), 1400);
	}

	#log(kind: ActivityItem['kind'], text: string) {
		this.#seq += 1;
		this.activity = [
			{ id: this.#seq, kind, text, version: this.snap?.plan.version ?? 0 },
			...this.activity
		].slice(0, 30);
	}
}
