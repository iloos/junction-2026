/* eslint-disable svelte/prefer-svelte-reactivity -- Maps and Sets here are built fresh and replaced wholesale ($state.raw), never mutated after. */
import type { Approval, DomainError, Line } from '$lib/core/contracts';
import { ToolError, Unreachable, call, rendered, type ApiMode, type RenderedView } from './api';
import type { ToolInput, ToolName, ToolOutput } from '$lib/core/contracts';
import type { PresetId } from './view-model';
import * as backend from './backend';
import type { Snapshot } from './backend';

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

/** The terms a line had when an approval was shown: what a later approval is compared against. */
export interface SeenTerm {
	productId: string;
	qty: number;
	unit: string;
	lineCents: number | null;
}

export interface TermChange {
	lineId: string;
	productId: string;
	before: SeenTerm | null;
	after: SeenTerm | null;
}

const termOf = (l: Line): SeenTerm => ({
	productId: l.productId,
	qty: l.qty.value,
	unit: l.qty.unit,
	lineCents: l.lineCents
});

/**
 * Client state for the kitchen screen. One store is one mode for its whole life: the live page never falls back
 * to the fixture basket. The snapshot is replaced wholesale after every call ($state.raw, never mutated).
 */
export class KitchenStore {
	readonly mode: ApiMode;
	snap = $state.raw<Snapshot | null>(null);
	/** Live: false until the chef starts the demo (planning is an explicit command, never a side effect of viewing). */
	started = $state<boolean | null>(null);
	/** Before the first plan: the kitchen the server would plan for (the pre-plan card reads its mandate). */
	startKitchen = $state<string | null>(null);
	busy = $state(false);
	/** A g/guest change waiting for the server, per dish: the stepper shows it as pending. */
	pendingGrams = $state.raw<Record<string, number>>({});
	error = $state.raw<DomainError | null>(null);
	/** Set when the last read failed: the screen keeps the last state, read-only, with a retry. */
	stale = $state.raw<{ message: string; unreachable: boolean } | null>(null);
	activity = $state.raw<ActivityItem[]>([]);
	/** Line ids that changed in the last update, for the row flash. */
	flash = $state.raw<Set<string>>(new Set());
	/** The snapshot before the latest change to this plan (the "What changed" strip); cleared by Dismiss. */
	changeFrom = $state.raw<Snapshot | null>(null);
	whyLineId = $state<string | null>(null);
	whySteps = $state.raw<{ text: string; source: string; detail?: string }[]>([]);
	lastCommit = $state.raw<CommitNote | null>(null);
	/**
	 * The plan this page opened by link: every read names it, so the server never has to remember it (a later
	 * request may reach another server process whose session has not seen the link).
	 */
	focusedPlan: string | null = null;
	/** Scenario "now" (Helsinki story time), ticking. */
	now = $state.raw<Date | null>(null);
	/** Plan version when this screen first saw the run: older voided approvals are history, not news. */
	firstVersion = $state<number | null>(null);
	runId = $state<string | null>(null);
	/** Terms shown under each approval id, so a replacement approval can say exactly what changed. */
	#seen = new Map<string, Map<string, SeenTerm>>();
	#clockBase: { scenarioMs: number; wallMs: number } | null = null;
	#seq = 0;
	#flashTimer: ReturnType<typeof setTimeout> | undefined;

	/** `shared`: the Kitchen screen's state, which also publishes its view for code with no state at hand. */
	constructor(
		mode: ApiMode,
		private readonly shared = true
	) {
		this.mode = mode;
	}

	plan = $derived(this.snap?.plan ?? null);
	view = $derived(this.snap?.view ?? null);
	readOnly = $derived(this.stale !== null || this.busy);

	lineById = $derived.by(() => {
		const m = new Map<string, Line>();
		for (const l of this.snap?.plan.lines ?? []) m.set(l.id, l);
		return m;
	});

	/** What changed since the approval the chef last saw was voided (empty when there is nothing to compare). */
	changes = $derived.by((): TermChange[] => {
		const old = this.snap?.lastInvalidated;
		const seen = old ? this.#seenFor(old) : null;
		const current = this.snap?.approval;
		if (!seen || !current || current.state !== 'pending' || !this.snap) return [];
		const now = new Map(
			this.snap.plan.lines
				.filter((l) => l.state === 'held' || l.state === 'eligible')
				.map((l) => [l.id, termOf(l)])
		);
		const out: TermChange[] = [];
		for (const [id, before] of seen) {
			const after = now.get(id) ?? null;
			if (!after || after.qty !== before.qty || after.lineCents !== before.lineCents)
				out.push({ lineId: id, productId: before.productId, before, after });
		}
		for (const [id, after] of now)
			if (!seen.has(id) && current.lineIds.includes(id))
				out.push({ lineId: id, productId: after.productId, before: null, after });
		return out;
	});

	#seenFor(a: Approval) {
		return this.#seen.get(a.id) ?? null;
	}

	/**
	 * First read. With `planId` (an approval link `/?kitchen&plan` from MCP, chat or Ops) the server opens that
	 * plan with its decisions; if this browser's sandbox has no such plan, the kitchen's own plan shows and the
	 * error says why.
	 */
	async load(planId?: string) {
		await this.#run(async () => {
			if (this.mode === 'fixture') {
				await call('fixture', 'plan_event', { kitchenId: 'k-hotel', eventId: 'event-xmas-140' });
				return;
			}
			if (!planId) return;
			this.opening = planId;
			this.linkMissing = null;
			try {
				// A just-written plan can take a moment to reach this server's view of the sandbox: ask again
				// briefly before saying the link's plan isn't here.
				for (let i = 0; ; i++) {
					try {
						const s = await backend.snapshot(this.mode, planId, !this.shared);
						this.focusedPlan = planId;
						return s;
					} catch (e) {
						const missing = e instanceof ToolError && e.error.code === 'NOT_FOUND';
						if (!missing || i >= 5) throw e;
						await new Promise((r) => setTimeout(r, 400 * (i + 1)));
					}
				}
			} catch (e) {
				if (e instanceof ToolError && e.error.code === 'NOT_FOUND') this.linkMissing = planId;
				else this.#fail(e);
			} finally {
				this.opening = null;
			}
		});
	}

	/** An approval link is being opened: the screen waits for that plan instead of showing the start screen. */
	opening = $state<string | null>(null);
	/** The link's plan is not in this browser's sandbox (after retrying): said plainly, never a start screen. */
	linkMissing = $state<string | null>(null);

	/** What the start screen shows while planning: the step under way, with real counts once known. */
	progress = $state<string | null>(null);

	/**
	 * Live: plan the event, then let the kitchen agent propose rescues. Two server steps, so the progress label
	 * names the step actually running; the second step's answer is the snapshot (no extra read).
	 */
	async start() {
		await this.#run(async () => {
			this.progress = 'Planning the menu: guests × grams → needs → Valio lines…';
			const p = await backend.planStep();
			this.progress = `Planned ${p.dishes} needs, ${p.lines} Valio lines. Finding rescues for ${p.outages} ${p.outages === 1 ? 'outage' : 'outages'}…`;
			const snap = await backend.rescueStep();
			this.#log(
				'rules',
				`Demo started: ${p.dishes} needs planned, rescues proposed for ${p.outages} outages`
			);
			return snap;
		});
		this.progress = null;
	}

	async retry() {
		await this.#run(async () => {});
	}

	/** Who made the latest change shown in What changed, when it wasn't this screen. */
	changeBy = $state<'dock' | 'agent' | 'outside' | null>(null);
	#by: 'dock' | 'agent' | 'outside' | null = null;
	/** The plan changed elsewhere (the dock, the agent, an outside agent): re-read it and say who changed it. */
	/** What was done to this plan elsewhere, in one line (an approval, an order), until dismissed. */
	outsideNote = $state<{ by: 'dock' | 'agent' | 'outside'; text: string } | null>(null);
	async refreshFrom(by: 'dock' | 'agent' | 'outside', text?: string | null) {
		if (text) this.outsideNote = { by, text };
		if (this.busy) return;
		this.#by = by;
		await this.retry();
		this.#by = null;
	}

	async setGrams(dishId: string, grams: number) {
		const dish = this.view?.dishes.find((d) => d.id === dishId);
		if (!dish || !this.plan || grams === dish.gServed || this.readOnly) return;
		this.pendingGrams = { ...this.pendingGrams, [dishId]: grams };
		await this.#run(async () => {
			await this.#call('edit_line', {
				planId: this.plan!.id,
				version: this.plan!.version,
				needId: dish.needId,
				patch: { gramsPerGuest: grams }
			});
			this.#log('edit', `${dish.nameFi}: ${dish.gServed} → ${grams} g per guest`);
		});
		const rest = { ...this.pendingGrams };
		delete rest[dishId];
		this.pendingGrams = rest;
	}

	async setPreset(preset: PresetId) {
		if (this.snap?.preset === preset || this.readOnly) return;
		await this.#run(async () => {
			const answer = await backend.setPreset(this.mode, preset, this.focusedPlan);
			this.#log(
				'rules',
				`Rules: ${preset === 'kitchen' ? 'kitchen default' : preset === 'price' ? 'price first' : 'Finnish required'}`
			);
			return answer;
		});
	}

	async applyRules() {
		if (this.readOnly) return;
		await this.#run(async () => {
			const answer = await backend.applyRules(this.mode, this.focusedPlan);
			this.#log('rules', 'Applied the previewed rules to the order: approval voided, re-quoted');
			return answer;
		});
	}

	async setKitchen(kitchenId: string) {
		if (this.readOnly) return;
		await this.#run(async () => {
			const answer = await backend.setKitchen(this.mode, kitchenId);
			this.focusedPlan = null;
			this.lastCommit = null;
			this.#log('rules', `Kitchen: ${kitchenId}`);
			return answer;
		});
	}

	async setContention(on: boolean) {
		if (this.readOnly) return;
		await this.#run(async () => {
			const answer = await backend.setContention(this.mode, on, this.focusedPlan);
			this.#log(
				'sim',
				on
					? 'Simulator: another kitchen took 4 × palvikinkku 476768'
					: 'Simulator: contention cleared'
			);
			return answer;
		});
	}

	async reset() {
		await this.#run(async () => {
			const answer = await backend.reset(this.mode);
			this.focusedPlan = null;
			this.lastCommit = null;
			this.activity = [];
			this.#seen.clear();
			this.firstVersion = null;
			return answer;
		});
	}

	/** Decide the pending approval, or only `lineIds` of it (one reason group; the rest stay pending). */
	async approve(decision: 'grant' | 'deny' = 'grant', lineIds?: string[]) {
		const a = this.snap?.approval;
		if (!a || this.readOnly) return false;
		let ok = false;
		await this.#run(async () => {
			const out = await this.#call('approve', {
				approvalId: a.id,
				planVersion: a.planVersion,
				termsHash: a.termsHash,
				decision,
				...(lineIds ? { lineIds } : {})
			});
			ok = out.state === 'granted' || (decision === 'deny' && out.state === 'denied');
			// The grant must be visible before the panel moves on: re-read if the store still says pending.
			for (let i = 0; ok && i < 3; i++) {
				const s = await backend.snapshot(this.mode, this.focusedPlan ?? undefined, !this.shared);
				if (!('plan' in s) || s.approval?.id !== a.id || s.approval.state !== 'pending') break;
				await new Promise((r) => setTimeout(r, 250));
			}
			this.#log(
				'approval',
				`${out.state}: ${(lineIds ?? a.lineIds).length} lines, bound to v${a.planVersion} · ${a.termsHash.slice(0, 8)}`
			);
		});
		return ok;
	}

	async commit() {
		if (!this.plan || this.readOnly) return;
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
			const out = await this.#call('commit_order', {
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
					: `${out.orderId} ordered: ${out.committedLineIds.length} lines, receipt ${out.receiptId}`
			);
		});
	}

	async openWhy(lineId: string) {
		if (!this.plan) return;
		try {
			const out = await this.#call('explain_line', { planId: this.plan.id, lineId });
			this.whySteps = out.steps;
			this.whyLineId = lineId;
		} catch (e) {
			this.#fail(e);
		}
	}

	closeWhy() {
		this.whyLineId = null;
	}

	/**
	 * What this state last rendered (run, plan, version), sent with its commands: its own, so a second state (the
	 * dock's) can't change what the page sends.
	 */
	rendered: RenderedView | null = null;
	#call<N extends ToolName>(name: N, input: ToolInput<N>): Promise<ToolOutput<N>> {
		return call(this.mode, name, input, this.rendered, this.shared ? undefined : 'dock');
	}

	/** Runs a command, then shows the snapshot it answered with, or reads one when it answered nothing. */
	async #run(fn: () => Promise<backend.Answer | void>) {
		this.busy = true;
		this.error = null;
		const before = this.snap?.plan.lines ?? [];
		let answer: backend.Answer | void = null;
		try {
			answer = await fn();
		} catch (e) {
			this.#fail(e);
		}
		try {
			const next =
				answer ?? (await backend.snapshot(this.mode, this.focusedPlan ?? undefined, !this.shared));
			this.stale = null;
			if ('plan' in next) {
				this.started = true;
				// What this change did, for the strip: same plan, newer version, nothing ordered by it.
				const prev = this.snap;
				const orderedNow =
					next.plan.lines.filter((l) => l.state === 'committed').length >
					(prev?.plan.lines.filter((l) => l.state === 'committed').length ?? 0);
				const newChange =
					prev && prev.plan.id === next.plan.id && next.plan.version > prev.plan.version;
				this.changeFrom =
					newChange && !orderedNow ? prev : prev?.plan.id === next.plan.id ? this.changeFrom : null;
				if (newChange) this.changeBy = this.#by;
				this.snap = next;
				// Pin the plan on screen: every later read and command names it, so another screen on this browser
				// (the dock's own state) moving the server session can never switch what this one shows.
				this.focusedPlan = next.plan.id;
				this.#receiptFrom(next);
				this.rendered =
					this.mode === 'live' && next.clock
						? { runId: next.clock.runId, planId: next.plan.id, version: next.plan.version }
						: null;
				if (this.shared) rendered.view = this.rendered;
				this.#remember(next);
				this.#clockAt(next);
				this.#flashChanges(before, next.plan.lines);
			} else {
				this.started = false;
				this.startKitchen = next.kitchenId;
				this.snap = null;
			}
		} catch (e) {
			// Keep the last state, read-only, and say so. Never substitute another basket for a failed read.
			const err = e instanceof ToolError ? e.error : null;
			this.stale = {
				message: err?.message ?? (e instanceof Error ? e.message : String(e)),
				unreachable: e instanceof Unreachable
			};
		} finally {
			this.busy = false;
		}
	}

	/**
	 * The receipt survives a reload: when this page has none (or one from another plan or run), it is rebuilt
	 * from the plan's newest stored order, so "Ordered", the receipt and "send the same order again" stay.
	 */
	#receiptFrom(s: Snapshot) {
		const last = s.orders.at(-1);
		if (!last) {
			this.lastCommit = null;
			return;
		}
		if (this.lastCommit && s.orders.some((o) => o.output.orderId === this.lastCommit!.orderId))
			return;
		this.lastCommit = {
			key: last.key ?? '',
			orderId: last.output.orderId,
			receiptId: last.output.receiptId,
			totalCents: last.output.totalCents,
			lines: last.output.committedLineIds.length,
			awaiting: last.output.awaitingSupplier.length,
			replayed: false
		};
	}

	#remember(s: Snapshot) {
		const a = s.approval;
		if (a && a.state === 'pending' && !this.#seen.has(a.id))
			this.#seen.set(
				a.id,
				new Map(s.plan.lines.filter((l) => a.lineIds.includes(l.id)).map((l) => [l.id, termOf(l)]))
			);
	}

	#fail(e: unknown) {
		if (e instanceof ToolError) {
			this.error = e.error;
			// A cooldown is a wait, not a failure.
			if (e.error.detail?.retryInMs) this.#log('sim', e.error.message);
			else this.#log('error', `${e.error.code}: ${e.error.message}`);
		} else {
			const message = e instanceof Error ? e.message : String(e);
			this.error = { code: 'PROVIDER_UNAVAILABLE', message, retryable: true };
			this.#log('error', message);
		}
	}

	/** The scenario clock: the server's reading at snapshot time, then advanced by the wall clock. */
	#clockAt(s: Snapshot) {
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
