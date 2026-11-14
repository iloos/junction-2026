<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { ChevronDown, Play, CloudOff, LoaderCircle } from '@lucide/svelte';
	import { KitchenStore } from '$lib/kitchen/kitchen.svelte';
	import { KITCHENS, PRODUCTS } from '$lib/kitchen/catalog';
	import type { DishView } from '$lib/kitchen/view-model';
	import type { Line } from '$lib/core/contracts';
	import { useShell } from '$lib/ui/shell/shell.svelte';
	import TaskHeader from '$lib/ui/TaskHeader.svelte';
	import LineRow from '$lib/ui/LineRow.svelte';
	import StrategyCard from '$lib/ui/StrategyCard.svelte';
	import { decisionCount, decisionsDue, decisionsOf } from '$lib/ui/decisions';
	import GramsStepper from '$lib/ui/GramsStepper.svelte';
	import WhyDrawer from '$lib/ui/WhyDrawer.svelte';
	import CoverageRuler from '$lib/ui/CoverageRuler.svelte';
	import CoverageLegend from '$lib/ui/CoverageLegend.svelte';
	import { whyChain } from '$lib/ui/why-chain';
	import { day, fixed, money, moneyDelta, num, storyTime } from '$lib/ui/format';
	import { SCENARIO } from '$lib/core/scenario';
	import { reasonShort } from '$lib/ui/reasons';
	import RescueCompare from '$lib/ui/RescueCompare.svelte';
	import RulesPanel from './RulesPanel.svelte';
	import ApprovalPanel from './ApprovalPanel.svelte';
	import CutoffTimeline from '$lib/ui/viz/CutoffTimeline.svelte';

	import type { ApiMode } from '$lib/kitchen/api';

	let { mode }: { mode: ApiMode } = $props();
	// One store, one mode, for the life of the page: live never turns into the fixture basket.
	// svelte-ignore state_referenced_locally
	const k = new KitchenStore(mode);
	/**
	 * Deep link from Operations: /?ws=<workspace>&run=<runId>&kitchen=<id>&plan=<planId>&v=<version>&need=<needId>.
	 * The server already moved this browser into `ws` if it may enter it (server/demo/visitor.ts). Client-side
	 * focus only: switch kitchen through the normal command, then scroll to the need, open its rescue, highlight it.
	 */
	let fromOps = $state<{
		ws: string;
		run: string;
		kitchen: string;
		plan: string;
		v: number;
		need: string;
	} | null>(null);
	let focusNeed = $state<string | null>(null);
	async function honourDeepLink() {
		const q = new URL(location.href).searchParams;
		const kitchen = q.get('kitchen');
		if (!kitchen) return;
		fromOps = {
			ws: q.get('ws') ?? '',
			run: q.get('run') ?? '',
			kitchen,
			plan: q.get('plan') ?? '',
			v: Number(q.get('v') ?? NaN),
			need: q.get('need') ?? ''
		};
		if (k.snap && k.snap.kitchen.id !== kitchen) await k.setKitchen(kitchen);
		const dish = k.view?.dishes.find((d) => d.needId === fromOps!.need);
		if (!dish) return;
		toggled = { ...toggled, [dish.id]: true };
		focusNeed = dish.needId;
		await tick();
		document
			.getElementById(`need-${dish.id}`)
			?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	onMount(() => {
		k.load().then(honourDeepLink);
		const t = setInterval(() => k.tick(), 1000);
		return () => clearInterval(t);
	});

	// Names from the server's lines first, the fixture catalogue as a fallback.
	const names = $derived(
		new Map([
			...Object.values(PRODUCTS).map((p) => [p.productId, p.name] as const),
			...(k.plan?.lines ?? [])
				.filter((l) => l.productName)
				.map((l) => [l.productId, l.productName!] as const)
		])
	);
	let toggled = $state<Record<string, boolean>>({});
	// The first real outage opens by default; the chef's own toggles win after that.
	const open = $derived.by(() => {
		const first = view?.dishes.find((d) => d.rescue)?.id;
		return first && toggled[first] === undefined ? { ...toggled, [first]: true } : toggled;
	});

	// The phone's sticky "needs you" bar steps aside once the approval card itself is on screen.
	let approvalInView = $state(false);
	$effect(() => {
		if (!snap) return;
		const el = document.getElementById('approval');
		if (!el) return;
		const io = new IntersectionObserver(([e]) => (approvalInView = e.isIntersecting), {
			threshold: 0.15
		});
		io.observe(el);
		return () => io.disconnect();
	});

	const snap = $derived(k.snap);
	const view = $derived(k.view);
	const plan = $derived(k.plan);
	const approval = $derived(snap?.approval ?? null);
	const approvedIds = $derived(new Set(approval?.state === 'granted' ? approval.lineIds : []));

	const whyLine = $derived(k.whyLineId ? (k.lineById.get(k.whyLineId) ?? null) : null);
	const whyDish = $derived(view?.dishes.find((d) => d.lineIds.includes(k.whyLineId ?? '')) ?? null);

	/** The worked calculation for the open Why line, from the plan's own numbers. */
	const chain = $derived.by(() => {
		if (!whyLine || !plan) return null;
		const need = plan.needs.find((n) => n.id === whyLine.needId);
		return whyChain({
			need,
			line: whyLine,
			siblings: plan.lines.filter((l) => l.needId === whyLine.needId),
			fulfilment: need ? coverage.get(need.id) : undefined,
			basis: (l) => l.view,
			name: (id) => names.get(id) ?? id,
			dish:
				whyDish && view
					? {
							gServed: whyDish.gServed,
							defaultGServed: whyDish.gDefault,
							guests: view.guests,
							yield: whyDish.yield,
							formula: whyDish.needFormula
						}
					: undefined
		});
	});

	const weekMeter = $derived.by(() => {
		if (!snap || !plan) return null;
		const cap = snap.rules.weeklyCapCents;
		const spent = snap.view.weekSpentCents;
		// Week spend already includes what this plan ordered; "this order" is only what is not ordered yet.
		const order = plan.lines
			.filter((l) => l.state !== 'committed' && l.state !== 'rejected' && l.state !== 'unorderable')
			.reduce((a, l) => a + (l.lineCents ?? 0), 0);
		return {
			cap,
			spent,
			order,
			spentPct: (spent / cap) * 100,
			orderPct: Math.min(100 - (spent / cap) * 100, (order / cap) * 100),
			over: spent + order > cap
		};
	});

	/** The Valio label from the offers actually on the plan: their source and the newest observation time. */
	const valioSource = $derived.by(() => {
		let at: string | null = null;
		let live = false;
		for (const l of plan?.lines ?? []) {
			const pv = l.offer?.price?.provenance ?? l.offer?.availability.provenance;
			if (!pv) continue;
			if (pv.source === 'valio_live') live = true;
			if (pv.at && (!at || pv.at > at)) at = pv.at;
		}
		return at ? { live, at } : null;
	});

	/** Plain-words list of what the order still does not cover (residuals and unconfirmed supply). */
	const shortfalls = $derived.by(() => {
		// The server's coverage partition is the one definition (F12/F15); the dish-level fallback is for plans
		// without a read model.
		if (coverage.size) {
			const out: string[] = [];
			const label = (id: string) => view?.dishes.find((d) => d.needId === id)?.nameFi ?? id;
			const m = (v: number, u: string) => `${num(v, v < 10 ? 2 : 1)} ${u}`;
			for (const f of coverage.values()) {
				if (f.unresolved.value > 0)
					out.push(`${label(f.needId)}: ${m(f.unresolved.value, f.unresolved.unit)} not covered`);
				if (f.plannedUnknown.value > 0)
					out.push(
						`${label(f.needId)}: ${m(f.plannedUnknown.value, f.plannedUnknown.unit)} planned, but the supplier states no quantity, so it is not cover`
					);
			}
			return out;
		}
		const out: string[] = [];
		for (const d of view?.dishes ?? []) {
			if (d.rescue?.residual) out.push(`${d.nameFi}: ${d.rescue.residual.text}`);
			else if (d.status === 'shortfall') out.push(`${d.nameFi}: no option qualifies`);
		}
		return out;
	});

	/** Decisions: the one count the header, the panel and the phone bar share. */
	const decisions = $derived(plan ? decisionsOf(plan, approval) : []);
	const orderable = $derived.by(() => {
		const ls = (plan?.lines ?? []).filter((l) => l.view?.committable === true);
		return { lines: ls.length, cents: ls.reduce((a, l) => a + (l.lineCents ?? 0), 0) };
	});
	/** Once every orderable line is ordered, the header becomes the order's state. */
	const orderedState = $derived.by(() => {
		const done = (plan?.lines ?? []).filter((l) => l.state === 'committed');
		if (!done.length || orderable.lines > 0 || !k.lastCommit) return null;
		return {
			confirmed: k.lastCommit.lines - k.lastCommit.awaiting,
			awaiting: k.lastCommit.awaiting,
			cents: done.reduce((a, l) => a + (l.lineCents ?? 0), 0)
		};
	});

	/** The header's "what needs you", in D10 terms and on the same basis as the panel and Ops. */
	const needsYou = $derived.by(() => {
		const pendingLines = approval?.state === 'pending' ? approval.lineIds.length : 0;
		const cannot = (plan?.lines ?? []).filter((l) => l.state === 'unorderable').length;
		const fs = [...coverage.values()];
		return {
			pendingLines,
			cannot,
			uncovered: fs.filter((f) => f.unresolved.value > 0).length,
			unknown: fs.length
				? fs.filter((f) => f.plannedUnknown.value > 0).length
				: (view?.counts.unknown ?? 0)
		};
	});

	/** Open lines by supply kind, for the cut-off timeline. */
	const openLines = $derived.by(() => {
		let stock = 0;
		let terminal = 0;
		for (const l of plan?.lines ?? []) {
			if (l.state !== 'held' && l.state !== 'eligible') continue;
			if (
				l.offer?.availability.logisticModel === 'Terminal' ||
				l.offer?.availability.kind === 'unknown'
			)
				terminal++;
			else stock++;
		}
		return { stock, terminal };
	});

	/** Server-derived coverage per need (Plan.view.fulfilment); absent on plans without a read model. */
	const coverage = $derived(new Map((plan?.view?.fulfilment ?? []).map((f) => [f.needId, f])));

	function linesOf(d: DishView): Line[] {
		return d.lineIds.map((id) => k.lineById.get(id)).filter((l): l is Line => !!l);
	}
	const needUnit = (u: string) => (u === 'pcs' ? 'pcs' : u);

	// The shell shows the sandbox (workspace, run, clock, start over) and where the data comes from.
	const shell = useShell();
	$effect(() => {
		if (!shell) return;
		shell.labels = { source: valioSource, offline: k.mode === 'fixture' };
		shell.sandbox = snap?.clock
			? {
					workspace: snap.clock.workspaceId ?? 'ws-demo',
					run: snap.clock.runId,
					clock: storyTime(k.now ?? new Date(SCENARIO.start)),
					busy: k.busy,
					onReset: () => k.reset()
				}
			: null;
		return () => {
			shell.labels = null;
			shell.sandbox = null;
		};
	});

	/** A make-in-house strategy is one AND group; every other line stands alone. */
	function groupLines(ls: Line[]): { key: string; make: boolean; lines: Line[] }[] {
		const out: { key: string; make: boolean; lines: Line[] }[] = [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, rebuilt on every call
		const make = new Map<string, Line[]>();
		for (const l of ls) {
			if (l.strategy?.kind === 'make_in_house') {
				const g = make.get(l.strategy.id);
				if (g) g.push(l);
				else {
					const lines = [l];
					make.set(l.strategy.id, lines);
					out.push({ key: l.strategy.id, make: true, lines });
				}
			} else out.push({ key: l.id, make: false, lines: [l] });
		}
		return out;
	}
</script>

<svelte:head>
	<title>Mandate · Kitchen</title>
	<meta
		name="description"
		content="Christmas buffet for 140: what the purchasing agent may do alone, and what it must ask."
	/>
</svelte:head>

<header class="border-b border-rule bg-sheet">
	<div
		class="mx-auto flex max-w-[1440px] flex-col gap-x-5 gap-y-2 px-4 py-2.5 sm:flex-row sm:items-center md:px-6"
	>
		<label class="flex shrink-0 items-center gap-2 text-body text-ink-2">
			<span class="sr-only md:not-sr-only">Kitchen</span>
			<select
				class="h-8 rounded-md border border-rule-strong bg-sheet px-2 text-body font-medium text-ink"
				value={snap?.kitchen.id ?? 'k-hotel'}
				disabled={k.readOnly || !snap}
				onchange={(e) => k.setKitchen(e.currentTarget.value)}
			>
				{#each KITCHENS as kit (kit.id)}
					<option value={kit.id}>{kit.name.replace(' (fictional)', '')}</option>
				{/each}
			</select>
		</label>
		{#if snap}
			<p class="max-w-[95ch] min-w-0 text-meta text-ink-2">
				<span class="font-medium text-ink">Mandate, in the chef's words:</span>
				“{snap.rules.words}”
			</p>
		{/if}
	</div>
</header>

{#if k.stale}
	<div class="border-b border-signoff/40 bg-signoff-wash" role="status">
		<div
			class="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-body text-ink md:px-6"
		>
			<CloudOff size={16} class="shrink-0 text-signoff" aria-hidden="true" />
			<p class="min-w-0 flex-1">
				<b class="font-medium"
					>{k.stale.unreachable
						? "Can't reach the server."
						: 'The server answered with an error.'}</b
				>
				{snap
					? 'Showing the last live state, read-only: nothing here has been changed or sent.'
					: 'No live state yet.'}
				<span class="text-ink-2">{k.stale.message}</span>
			</p>
			<button
				type="button"
				class="h-8 rounded-md bg-ink px-3 text-body font-medium text-sheet disabled:opacity-50"
				disabled={k.busy}
				onclick={() => k.retry()}>Retry</button
			>
			{#if mode === 'live'}
				<a href={resolve('/offline')} class="text-meta text-ink-2 underline underline-offset-2"
					>Open the offline demonstration (a separate basket)</a
				>
			{/if}
		</div>
	</div>
{/if}

{#if fromOps && snap}
	<div class="border-b border-propose/30 bg-propose-wash" role="status">
		<div
			class="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-body text-ink md:px-6"
		>
			<b class="font-medium">Opened from Operations</b>
			<span class="text-ink-2"
				>{snap.kitchen.name.replace(' (fictional)', '')} · {view?.dishes.find(
					(d) => d.needId === fromOps!.need
				)?.nameFi ?? fromOps.need}</span
			>
			{#if fromOps.ws && snap.clock?.workspaceId && fromOps.ws !== snap.clock.workspaceId}
				<span class="text-signoff"
					>The link is from another sandbox, which only its own browser can open; showing yours.</span
				>
			{:else if fromOps.run && snap.clock?.runId && fromOps.run !== snap.clock.runId}
				<span class="text-signoff"
					>The link is from an earlier run of this sandbox (it was started over); showing the
					current plan.</span
				>
			{:else if fromOps.plan && fromOps.plan !== snap.plan.id}
				<span class="text-signoff"
					>The link points to another plan ({fromOps.plan}); showing this kitchen's current plan.</span
				>
			{:else if Number.isFinite(fromOps.v) && fromOps.v !== snap.plan.version}
				<span class="text-signoff"
					>Operations saw v{fromOps.v}; the plan is now v{snap.plan.version}. Check what changed
					before acting.</span
				>
			{/if}
			<button
				type="button"
				class="ml-auto text-meta text-ink-2 underline underline-offset-2"
				onclick={() => ((fromOps = null), (focusNeed = null))}>Dismiss</button
			>
		</div>
	</div>
{/if}

{#if k.started === false}
	<main class="mx-auto max-w-[720px] px-4 py-14 md:px-6">
		<h1 class="text-title font-semibold tracking-[-0.015em] text-ink">
			Christmas dinner buffet, 140 guests
		</h1>
		<p class="mt-2 max-w-[60ch] text-body leading-relaxed text-ink-2">
			Starting the demo plans the event for this kitchen on the server: menu × guests → needs →
			Valio lines, then the kitchen agent proposes a rescue for each real outage. Nothing is ordered
			until you commit.
		</p>
		<button
			type="button"
			class="mt-5 inline-flex h-11 items-center gap-2 rounded-md bg-accent px-5 text-body font-medium text-sheet hover:bg-accent-ink disabled:opacity-50"
			disabled={k.busy}
			onclick={() => k.start()}
		>
			<Play size={16} aria-hidden="true" />
			{k.busy ? 'Planning…' : 'Plan the event'}
		</button>
		{#if k.progress}
			<p class="mt-4 flex items-center gap-2 text-body text-ink-2" role="status" aria-live="polite">
				<LoaderCircle size={15} class="animate-spin text-accent" aria-hidden="true" />
				{k.progress}
			</p>
		{/if}
		{#if k.error}
			<p class="mt-4 text-body text-out" role="alert">{k.error.message}</p>
		{/if}
	</main>
{:else if !snap || !view || !plan}
	<main class="mx-auto max-w-[1440px] px-4 py-10 md:px-6" aria-busy="true">
		<div class="h-7 w-80 animate-pulse rounded bg-well"></div>
		<div class="mt-6 h-64 animate-pulse rounded bg-well"></div>
	</main>
{:else}
	{#snippet lineRow(l: Line, d: DishView)}
		<LineRow
			line={l}
			name={names.get(l.productId) ?? l.productId}
			approved={approvedIds.has(l.id)}
			flash={k.flash.has(l.id)}
			replaces={l.substituteFor
				? {
						name: names.get(l.substituteFor) ?? l.substituteFor,
						because:
							d.outage === 'undeliverable' ? "Valio can't deliver it" : 'out of stock at Valio'
					}
				: undefined}
			onwhy={() => k.openWhy(l.id)}
		/>
	{/snippet}
	<main
		class="mx-auto grid max-w-[1440px] grid-cols-1 gap-6 px-4 pt-5 pb-28 md:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:pb-10"
	>
		<div class="min-w-0">
			<!-- The task: decisions left, by when, cover by certainty; the event as a diff of a normal week -->
			<section aria-label="This task">
				<TaskHeader
					title={view.title}
					meta="{day(view.date)} · {view.guests} guests · {view.serviceStyle} · delivery {day(
						plan.deliverBy
					)}"
					decisions={decisions.length}
					due={decisionsDue(plan, approval)}
					now={k.now}
					coverage={[...coverage.values()]}
					cannot={needsYou.cannot}
					{orderable}
					ordered={orderedState}
				>
					{#snippet action()}
						{#if decisions.length}
							<a
								href="#approval"
								class="inline-flex h-10 items-center gap-1.5 rounded-md bg-ink px-4 text-body font-medium text-sheet hover:bg-ink-2"
								>Review {decisions.length === 1 ? 'the decision' : 'decisions'}</a
							>
						{/if}
					{/snippet}
				</TaskHeader>
				<p class="mt-2 text-meta text-ink-2">
					A normal week <span class="mono">{money(view.normalWeek.cents, { whole: true })}</span>
					({view.normalWeek.lines} lines) → this week
					<span class="mono text-ink">{money(view.thisWeek.cents, { whole: true })}</span>
					({view.thisWeek.lines} lines): the event adds
					<span class="mono text-ink"
						>{moneyDelta(view.thisWeek.cents - view.normalWeek.cents)}</span
					>
					and <span class="mono">{fixed(view.eventKg)}</span> kg of food.
				</p>
				{#if weekMeter}
					<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-3">
						<span class="shrink-0">Week budget</span>
						<div
							class="relative h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-well"
							role="img"
							aria-label="Weekly spend against cap"
						>
							<span
								class="absolute inset-y-0 left-0 bg-ink-3/60"
								style="width: {weekMeter.spentPct}%"
							></span>
							<span
								class="absolute inset-y-0 transition-[width] duration-300 {weekMeter.over
									? 'bg-out'
									: 'bg-accent'}"
								style="left: {weekMeter.spentPct}%; width: {weekMeter.orderPct}%"
							></span>
						</div>
						<span class="text-ink-2">
							<span class="mono">{money(weekMeter.spent, { whole: true })}</span> spent +
							<span class="mono">{money(weekMeter.order, { whole: true })}</span> this order of
							<span class="mono">{money(weekMeter.cap, { whole: true })}</span>
						</span>
					</div>
				{/if}
				{#if view.planReasons.length}
					<p class="mt-2 rounded-md bg-signoff-wash px-3 py-2 text-body text-ink">
						The whole order is held: {view.planReasons.map(reasonShort).join(', ').toLowerCase()}.
						Every line needs sign-off.
					</p>
				{/if}
			</section>

			<div class="mt-5">
				<CutoffTimeline
					now={k.now}
					stock={openLines.stock}
					terminal={openLines.terminal}
					committed={openLines.stock + openLines.terminal === 0 && view.counts.committed > 0}
				/>
			</div>

			<!-- Dish table -->
			<section aria-labelledby="dishes-h" class="mt-6">
				<div class="flex items-baseline justify-between gap-4">
					<h2 id="dishes-h" class="text-heading font-semibold text-ink">Menu → need → order</h2>
					<p class="hidden text-meta text-ink-3 md:block">
						Change grams per guest and the order recomputes: need, lots, price, mandate.
					</p>
				</div>
				{#if coverage.size}
					<div class="mt-2"><CoverageLegend /></div>
				{/if}
				<div class="mt-2 overflow-hidden rounded-lg border border-rule bg-sheet">
					<div
						class="hidden grid-cols-[minmax(150px,0.7fr)_minmax(210px,0.9fr)_minmax(0,3fr)] gap-x-4 border-b border-rule bg-well px-4 py-2 text-micro font-medium text-ink-3 lg:grid"
					>
						<span>Dish</span>
						<span>g per guest → need</span>
						<div class="grid grid-cols-[minmax(0,1fr)_84px_136px_28px] gap-3">
							<span>Order · rounding</span>
							<span class="text-right">€ ex VAT</span>
							<span>State</span>
							<span></span>
						</div>
					</div>
					{#each view.dishes as d (d.id)}
						{@const lines = linesOf(d)}
						<div
							id="need-{d.id}"
							class="scroll-mt-4 border-b border-rule last:border-b-0 {focusNeed === d.needId
								? 'bg-propose-wash/40 ring-2 ring-propose/50 ring-inset'
								: ''}"
						>
							<div
								class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(150px,0.7fr)_minmax(210px,0.9fr)_minmax(0,3fr)] lg:gap-y-0"
							>
								<div class="min-w-0">
									<p class="text-body leading-tight font-medium text-ink">{d.nameFi}</p>
									<p class="text-meta text-ink-3">{d.name}</p>
								</div>
								<div class="col-span-2 flex items-start gap-3 lg:col-span-1">
									<GramsStepper
										value={d.gServed}
										original={d.gDefault}
										label={d.nameFi}
										pending={k.pendingGrams[d.id]}
										disabled={k.readOnly || !d.editable}
										onchange={(g) => k.setGrams(d.id, g)}
									/>
									<div class="min-w-0 pt-1">
										<p
											class="text-body text-ink {k.flash.has(d.plannedLineId) ||
											k.flash.has(d.lineIds[1] ?? '')
												? 'landed'
												: ''}"
										>
											<span class="mono"
												>{d.need.unit === 'pcs'
													? d.need.value
													: fixed(d.need.value, d.need.value < 10 ? 2 : 1)}</span
											>
											{needUnit(d.need.unit)}
										</p>
										<p class="text-micro leading-snug text-ink-3">{d.needFormula}</p>
										<p class="mt-0.5 text-micro text-ink-3">
											{#if d.usual}normal week {num(d.usual.qty)} {d.usual.unit}{:else}<span
													class="rounded-sm bg-well px-1 text-ink-2">event only</span
												>{/if}
										</p>
									</div>
								</div>
								<ul class="col-span-2 space-y-2 lg:col-span-1">
									{#each groupLines(lines) as g (g.key)}
										{#if g.make}
											<li>
												<StrategyCard title={d.nameFi} lines={g.lines}>
													{#snippet row(l)}{@render lineRow(l, d)}{/snippet}
												</StrategyCard>
											</li>
										{:else}
											<li>{@render lineRow(g.lines[0], d)}</li>
										{/if}
									{/each}
								</ul>
							</div>
							{#if coverage.get(d.needId)}
								<div
									class="px-4 pb-3 lg:grid lg:grid-cols-[minmax(150px,0.7fr)_minmax(210px,0.9fr)_minmax(0,3fr)] lg:gap-x-4"
								>
									<div class="lg:col-span-2 lg:col-start-2">
										<CoverageRuler f={coverage.get(d.needId)!} />
									</div>
								</div>
							{/if}
							{#if d.rescue}
								<div class="px-4 pb-3">
									<button
										type="button"
										class="flex w-full items-center gap-2 text-left text-meta font-medium text-ink-2 hover:text-ink"
										aria-expanded={!!open[d.id]}
										onclick={() => (toggled = { ...toggled, [d.id]: !open[d.id] })}
									>
										<ChevronDown
											size={14}
											class="transition-transform duration-200 {open[d.id] ? '' : '-rotate-90'}"
											aria-hidden="true"
										/>
										{d.outage === 'out' ? 'Out of stock at Valio' : "Valio can't deliver it"} ·
										{d.rescue.kind === 'make_in_house'
											? 'make it in house'
											: `${d.rescue.candidates.length} substitutes ranked`}
										{#if d.status === 'partial'}<span class="text-signoff">· partial cover</span
											>{/if}
									</button>
									{#if open[d.id]}
										<div class="mt-2">
											<RescueCompare
												rescue={d.rescue}
												grams={d.gServed}
												onfit={(g) => k.setGrams(d.id, g)}
											/>
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
				<p class="mt-2 text-meta leading-snug text-ink-3">
					Grams per guest, yields and recipes are team estimates. Prices are Valio catalogue prices
					ex VAT; "Qty unknown" lines are Terminal items: ordered, but never counted as cover.
				</p>
			</section>
		</div>

		<aside class="space-y-4 lg:sticky lg:top-4 lg:self-start" aria-label="Rules and approval">
			<ApprovalPanel
				{plan}
				{approval}
				lastInvalidated={snap.lastInvalidated &&
				snap.lastInvalidated.planVersion >= (k.firstVersion ?? Infinity)
					? snap.lastInvalidated
					: null}
				changes={k.changes}
				{shortfalls}
				orders={snap.orders}
				lastCommit={k.lastCommit}
				{names}
				busy={k.busy}
				onapprove={(ids) => k.approve('grant', ids)}
				ondeny={(ids) => k.approve('deny', ids)}
				oncommit={() => k.commit()}
				onretry={() => k.retryCommit()}
			/>
			<RulesPanel
				rules={snap.rules}
				preset={snap.preset}
				contention={snap.contention}
				busy={k.busy}
				previews={view.dishes
					.filter((d) => d.rescue?.preview?.differs)
					.map((d) => ({
						dish: d.nameFi,
						recommended: d.rescue!.preview!.recommended,
						saved: d.rescue!.preview!.saved
					}))}
				onapply={() => k.applyRules()}
				onpreset={(p) => k.setPreset(p)}
				oncontention={(on) => k.setContention(on)}
			/>
			{#if k.error}
				{#if k.error.detail?.retryInMs}
					<p class="rounded-md bg-well px-3 py-2 text-meta text-ink" role="status">
						{k.error.message}
					</p>
				{:else}
					<p class="rounded-md bg-out-wash px-3 py-2 text-meta text-ink" role="alert">
						<b class="mono font-medium text-out">{k.error.code}</b>
						{k.error.message}
					</p>
				{/if}
			{/if}
			{#if k.activity.length}
				<section aria-labelledby="log-h" class="rounded-lg border border-rule bg-sheet px-4 py-3">
					<h2 id="log-h" class="text-body font-semibold text-ink">What happened</h2>
					<ol class="mt-1.5 space-y-1 text-meta text-ink-2">
						{#each k.activity as a (a.id)}
							<li class="flex gap-2">
								<span class="mono w-7 shrink-0 text-ink-3">v{a.version}</span>
								<span
									class={a.kind === 'error'
										? 'text-out'
										: a.kind === 'retry'
											? 'text-accent-ink'
											: ''}>{a.text}</span
								>
							</li>
						{/each}
					</ol>
				</section>
			{/if}
		</aside>
	</main>

	{#if decisions.length && !approvalInView}
		<a
			href="#approval"
			class="fixed inset-x-3 bottom-3 z-30 flex h-12 items-center justify-between rounded-lg bg-ink px-4 text-body font-medium text-sheet shadow-[0_8px_24px_-8px_oklch(0.2_0.02_255/0.5)] lg:hidden"
		>
			<span>{decisionCount(decisions.length)} before {storyTime(decisionsDue(plan, approval))}</span
			>
			<span>Review</span>
		</a>
	{/if}

	<WhyDrawer
		open={!!whyLine}
		line={whyLine}
		productName={whyLine ? (names.get(whyLine.productId) ?? whyLine.productId) : ''}
		dishName={whyDish ? `${whyDish.nameFi} (${whyDish.name})` : ''}
		steps={k.whySteps}
		{chain}
		onclose={() => k.closeWhy()}
	/>
{/if}
