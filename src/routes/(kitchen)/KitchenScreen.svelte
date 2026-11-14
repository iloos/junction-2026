<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { ChevronDown, CornerDownRight, Info, RotateCcw, Play, CloudOff } from '@lucide/svelte';
	import { KitchenStore } from '$lib/kitchen/kitchen.svelte';
	import { KITCHENS, PRODUCTS } from '$lib/kitchen/catalog';
	import type { DishView } from '$lib/kitchen/fixture-plan';
	import type { Line } from '$lib/core/contracts';
	import LabelBar from '$lib/ui/LabelBar.svelte';
	import StateChip from '$lib/ui/StateChip.svelte';
	import GramsStepper from '$lib/ui/GramsStepper.svelte';
	import WhyDrawer from '$lib/ui/WhyDrawer.svelte';
	import { day, fixed, money, moneyDelta, num, storyTime } from '$lib/ui/format';
	import { reasonShort } from '$lib/ui/reasons';
	import RescuePanel from './RescuePanel.svelte';
	import RulesPanel from './RulesPanel.svelte';
	import ApprovalPanel from './ApprovalPanel.svelte';

	import type { ApiMode } from '$lib/kitchen/api';

	let { mode }: { mode: ApiMode } = $props();
	// One store, one mode, for the life of the page: live never turns into the fixture basket.
	// svelte-ignore state_referenced_locally
	const k = new KitchenStore(mode);
	onMount(() => {
		k.load();
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

	const weekMeter = $derived.by(() => {
		if (!snap || !plan) return null;
		const cap = snap.rules.weeklyCapCents;
		const spent = snap.view.weekSpentCents;
		const order = plan.totalCents ?? 0;
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
		const out: string[] = [];
		for (const d of view?.dishes ?? []) {
			if (d.rescue?.residual) out.push(`${d.nameFi}: ${d.rescue.residual.text}`);
			else if (d.status === 'shortfall') out.push(`${d.nameFi}: no option qualifies`);
		}
		const unknown = (plan?.lines ?? []).filter(
			(l) =>
				(l.state === 'held' || l.state === 'eligible') &&
				(l.reasons.includes('UNKNOWN_REQUIRED') || l.reasons.includes('unknown'))
		).length;
		if (unknown)
			out.push(
				`${unknown} lines with no stated supplier quantity: ordered, but not confirmed cover`
			);
		return out;
	});

	function linesOf(d: DishView): Line[] {
		return d.lineIds.map((id) => k.lineById.get(id)).filter((l): l is Line => !!l);
	}
	const needUnit = (u: string) => (u === 'pcs' ? 'pcs' : u);
</script>

<svelte:head>
	<title>Mandate · Kitchen</title>
	<meta
		name="description"
		content="Christmas buffet for 140: what the purchasing agent may do alone, and what it must ask."
	/>
</svelte:head>

<LabelBar mode={k.mode} source={valioSource} />

<header class="border-b border-rule bg-sheet">
	<div class="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:px-6">
		<a
			href={resolve('/')}
			class="flex items-center gap-2 text-[16px] font-semibold tracking-[-0.01em] text-ink"
		>
			<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
				<rect
					x="1.5"
					y="1.5"
					width="17"
					height="17"
					rx="3"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
				/>
				<path
					d="M5.5 14V6.5l4.5 5 4.5-5V14"
					fill="none"
					stroke="var(--color-accent)"
					stroke-width="1.8"
					stroke-linejoin="round"
				/>
			</svg>
			Mandate
		</a>
		<label class="flex items-center gap-2 text-[13px] text-ink-2">
			<span class="sr-only md:not-sr-only">Kitchen</span>
			<select
				class="h-8 rounded-md border border-rule-strong bg-sheet px-2 text-[13.5px] font-medium text-ink"
				value={snap?.kitchen.id ?? 'k-hotel'}
				disabled={k.readOnly || !snap}
				onchange={(e) => k.setKitchen(e.currentTarget.value)}
			>
				{#each KITCHENS as kit (kit.id)}
					<option value={kit.id}>{kit.name.replace(' (fictional)', '')}</option>
				{/each}
			</select>
		</label>
		<div class="ml-auto flex items-center gap-4 text-[12.5px] text-ink-2">
			{#if snap?.clock}
				<span
					class="mono rounded-sm bg-well px-1.5 py-0.5 text-[11.5px] text-ink-2"
					title="Workspace and run this screen reads and writes"
					>{snap.clock.workspaceId ?? 'ws-demo'} · {snap.clock.runId}</span
				>
			{/if}
			<span
				><span class="mono text-ink">{k.now ? storyTime(k.now) : '—'}</span> · simulated clock</span
			>
			<button
				type="button"
				class="inline-flex items-center gap-1 hover:text-ink"
				disabled={k.busy}
				onclick={() => k.reset()}
			>
				<RotateCcw size={13} aria-hidden="true" /> Reset demo
			</button>
		</div>
	</div>
	{#if snap}
		<div class="mx-auto max-w-[1440px] px-4 pb-3 md:px-6">
			<p class="max-w-[95ch] text-[13px] leading-snug text-ink-2">
				<span class="font-medium text-ink">The mandate, in the chef's words:</span>
				“{snap.rules.words}”
			</p>
		</div>
	{/if}
</header>

{#if k.stale}
	<div class="border-b border-signoff/40 bg-signoff-wash" role="status">
		<div
			class="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-[13px] text-ink md:px-6"
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
				class="h-8 rounded-md bg-ink px-3 text-[13px] font-medium text-sheet disabled:opacity-50"
				disabled={k.busy}
				onclick={() => k.retry()}>Retry</button
			>
			{#if mode === 'live'}
				<a href={resolve('/offline')} class="text-[12.5px] text-ink-2 underline underline-offset-2"
					>Open the offline demonstration (a separate basket)</a
				>
			{/if}
		</div>
	</div>
{/if}

{#if k.started === false}
	<main class="mx-auto max-w-[720px] px-4 py-14 md:px-6">
		<h1 class="text-[22px] font-semibold tracking-[-0.015em] text-ink">
			Christmas dinner buffet, 140 guests
		</h1>
		<p class="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-ink-2">
			Starting the demo plans the event for this kitchen on the server: menu × guests → needs →
			Valio lines, then the kitchen agent proposes a rescue for each real outage. Nothing is ordered
			until you commit.
		</p>
		<button
			type="button"
			class="mt-5 inline-flex h-11 items-center gap-2 rounded-md bg-accent px-5 text-[14px] font-medium text-sheet hover:bg-accent-ink disabled:opacity-50"
			disabled={k.busy}
			onclick={() => k.start()}
		>
			<Play size={16} aria-hidden="true" />
			{k.busy ? 'Planning…' : 'Plan the event'}
		</button>
	</main>
{:else if !snap || !view || !plan}
	<main class="mx-auto max-w-[1440px] px-4 py-10 md:px-6" aria-busy="true">
		<div class="h-7 w-80 animate-pulse rounded bg-well"></div>
		<div class="mt-6 h-64 animate-pulse rounded bg-well"></div>
	</main>
{:else}
	<main
		class="mx-auto grid max-w-[1440px] gap-6 px-4 pt-5 pb-28 md:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:pb-10"
	>
		<div class="min-w-0">
			<!-- Event as a diff against a normal week -->
			<section aria-labelledby="event-h">
				<div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
					<h1 id="event-h" class="text-[22px] font-semibold tracking-[-0.015em] text-ink">
						{view.title}
					</h1>
					<p class="text-[13px] text-ink-2">
						{day(view.date)} · {view.guests} guests · {view.serviceStyle} · delivery {day(
							plan.deliverBy
						)}
					</p>
				</div>
				<div
					class="mt-3 grid grid-cols-2 overflow-hidden rounded-lg border border-rule bg-sheet md:grid-cols-4"
				>
					<div class="border-r border-b border-rule px-4 py-3 md:border-b-0">
						<p class="text-[12px] text-ink-3">A normal week</p>
						<p class="mono mt-0.5 text-[17px] text-ink-2">
							{money(view.normalWeek.cents, { whole: true })}
						</p>
						<p class="text-[12px] text-ink-3">{view.normalWeek.lines} lines</p>
					</div>
					<div class="border-b border-rule px-4 py-3 md:border-r md:border-b-0">
						<p class="text-[12px] text-ink-3">This week, with the event</p>
						<p class="mono mt-0.5 text-[17px] font-medium text-ink">
							{money(view.thisWeek.cents, { whole: true })}
						</p>
						<p class="text-[12px] text-ink-3">{view.thisWeek.lines} lines</p>
					</div>
					<div class="border-r border-rule px-4 py-3">
						<p class="text-[12px] text-ink-3">The event adds</p>
						<p class="mono mt-0.5 text-[17px] font-medium text-accent-ink">
							{moneyDelta(view.thisWeek.cents - view.normalWeek.cents)}
						</p>
						<p class="text-[12px] text-ink-3">
							<span class="mono">{fixed(view.eventKg)}</span> kg of food
						</p>
					</div>
					<div class="px-4 py-3">
						<p class="text-[12px] text-ink-3">What needs you</p>
						<p class="mt-0.5 text-[17px] font-medium text-ink">
							<span class="mono">{view.counts.held}</span> lines held
						</p>
						<p class="text-[12px] text-ink-3">
							{view.counts.outages} outages · {view.counts.unknown} unknown supply
						</p>
					</div>
				</div>
				{#if weekMeter}
					<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
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
					<p class="mt-2 rounded-md bg-signoff-wash px-3 py-2 text-[13px] text-ink">
						The whole order is held: {view.planReasons.map(reasonShort).join(', ').toLowerCase()}.
						Every line needs sign-off.
					</p>
				{/if}
			</section>

			<!-- Dish table -->
			<section aria-labelledby="dishes-h" class="mt-6">
				<div class="flex items-baseline justify-between gap-4">
					<h2 id="dishes-h" class="text-[15px] font-semibold text-ink">Menu → need → order</h2>
					<p class="hidden text-[12px] text-ink-3 md:block">
						Change grams per guest and the order recomputes: need, lots, price, mandate.
					</p>
				</div>
				<div class="mt-2 overflow-hidden rounded-lg border border-rule bg-sheet">
					<div
						class="hidden grid-cols-[minmax(150px,0.7fr)_minmax(210px,0.9fr)_minmax(0,3fr)] gap-x-4 border-b border-rule bg-well px-4 py-2 text-[11.5px] font-medium text-ink-3 lg:grid"
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
						<div class="border-b border-rule last:border-b-0">
							<div
								class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(150px,0.7fr)_minmax(210px,0.9fr)_minmax(0,3fr)] lg:gap-y-0"
							>
								<div class="min-w-0">
									<p class="text-[14px] leading-tight font-medium text-ink">{d.nameFi}</p>
									<p class="text-[12.5px] text-ink-3">{d.name}</p>
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
											class="text-[13.5px] text-ink {k.flash.has(d.plannedLineId) ||
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
										<p class="text-[11.5px] leading-snug text-ink-3">{d.needFormula}</p>
										<p class="mt-0.5 text-[11.5px] text-ink-3">
											{#if d.usual}normal week {num(d.usual.qty)} {d.usual.unit}{:else}<span
													class="rounded-sm bg-well px-1 text-ink-2">event only</span
												>{/if}
										</p>
									</div>
								</div>
								<ul class="col-span-2 space-y-2 lg:col-span-1">
									{#each lines as l (l.id)}
										{@const rejected = l.state === 'rejected' || l.state === 'unorderable'}
										{@const sub = !!l.substituteFor}
										<li
											class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-[5px] lg:grid-cols-[minmax(0,1fr)_84px_136px_28px] {k.flash.has(
												l.id
											)
												? 'landed'
												: ''}"
										>
											<div class="min-w-0">
												<p class="flex min-w-0 items-baseline gap-1.5 text-[13px]">
													{#if sub}<CornerDownRight
															size={13}
															class="shrink-0 translate-y-0.5 text-accent"
															aria-label="replaces the planned product"
														/>{/if}
													<span
														class="truncate {rejected
															? 'text-ink-3 line-through decoration-ink-3/60'
															: 'text-ink'}">{names.get(l.productId) ?? l.productId}</span
													>
												</p>
												<p class="mono text-[11.5px] leading-snug text-ink-3">
													<span class={rejected ? '' : 'text-ink-2'}
														>{num(l.qty.value)} {l.qty.unit}</span
													>
													{#if l.qty.rounding && !rejected}<span class="font-sans">
															· {l.qty.rounding}</span
														>{/if}
													{#if rejected}<span class="font-sans">
															· {l.productId} · not ordered</span
														>{/if}
												</p>
											</div>
											<span
												class="mono text-right text-[13px] {rejected ? 'text-ink-3' : 'text-ink'}"
											>
												{rejected ? '—' : money(l.lineCents)}
											</span>
											<span class="col-span-1 lg:col-span-1"
												><StateChip
													state={l.state}
													tier={l.tier}
													reasons={l.reasons}
													approved={approvedIds.has(l.id)}
													view={l.view}
												/></span
											>
											<button
												type="button"
												class="grid size-7 place-items-center justify-self-end rounded-md text-ink-3 hover:bg-well hover:text-ink"
												aria-label="Why this line"
												title="Why"
												onclick={() => k.openWhy(l.id)}><Info size={15} /></button
											>
										</li>
									{/each}
								</ul>
							</div>
							{#if d.rescue}
								<div class="px-4 pb-3">
									<button
										type="button"
										class="flex w-full items-center gap-2 text-left text-[12.5px] font-medium text-ink-2 hover:text-ink"
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
											<RescuePanel
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
				<p class="mt-2 text-[12px] leading-snug text-ink-3">
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
				onapprove={() => k.approve('grant')}
				ondeny={() => k.approve('deny')}
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
				<p class="rounded-md bg-out-wash px-3 py-2 text-[12.5px] text-ink" role="alert">
					<b class="mono font-medium text-out">{k.error.code}</b>
					{k.error.message}
				</p>
			{/if}
			{#if k.activity.length}
				<section aria-labelledby="log-h" class="rounded-lg border border-rule bg-sheet px-4 py-3">
					<h2 id="log-h" class="text-[13px] font-semibold text-ink">What happened</h2>
					<ol class="mt-1.5 space-y-1 text-[12.5px] text-ink-2">
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

	{#if approval?.state === 'pending' && !approvalInView}
		<a
			href="#approval"
			class="fixed inset-x-3 bottom-3 z-30 flex h-12 items-center justify-between rounded-lg bg-ink px-4 text-[14px] font-medium text-sheet shadow-[0_8px_24px_-8px_oklch(0.2_0.02_255/0.5)] lg:hidden"
		>
			<span>{approval.lineIds.length} lines need you</span>
			<span>Review</span>
		</a>
	{/if}

	<WhyDrawer
		open={!!whyLine}
		line={whyLine}
		productName={whyLine ? (names.get(whyLine.productId) ?? whyLine.productId) : ''}
		dishName={whyDish ? `${whyDish.nameFi} (${whyDish.name})` : ''}
		steps={k.whySteps}
		onclose={() => k.closeWhy()}
	/>
{/if}
