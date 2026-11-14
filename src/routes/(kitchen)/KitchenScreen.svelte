<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Bot, ChevronDown, Play, CloudOff, LoaderCircle, CircleX } from '@lucide/svelte';
	import { KitchenStore } from '$lib/kitchen/kitchen.svelte';
	import { KITCHENS, PRODUCTS, SEED } from '$lib/kitchen/catalog';
	import type { DishView } from '$lib/kitchen/view-model';
	import type { Line } from '$lib/core/contracts';
	import { useShell } from '$lib/ui/shell/shell.svelte';
	import TaskHeader from '$lib/ui/TaskHeader.svelte';
	import LineRow from '$lib/ui/LineRow.svelte';
	import StrategyCard from '$lib/ui/StrategyCard.svelte';
	import { decisionCount, decisionsDue, decisionsOf } from '$lib/ui/decisions';
	import GramsStepper from '$lib/ui/GramsStepper.svelte';
	import WhyDrawer from '$lib/ui/WhyDrawer.svelte';
	import DishStatus from '$lib/ui/DishStatus.svelte';
	import AgentMark from '$lib/ui/AgentMark.svelte';
	import { planDiff } from '$lib/ui/plan-diff';
	import { dishGate } from '$lib/ui/coverage';
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
		// The linked plan already brought its kitchen; switch only when the link names a kitchen and no plan.
		if (!fromOps.plan && k.snap && k.snap.kitchen.id !== kitchen) await k.setKitchen(kitchen);
		const dish = k.view?.dishes.find((d) => d.needId === fromOps!.need);
		if (!dish) return;
		toggled = { ...toggled, [dish.id]: true };
		focusNeed = dish.needId;
		await tick();
		document
			.getElementById(`need-${dish.id}`)
			?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	/**
	 * An approval link names the plan: open it (in this browser's sandbox), not the kitchen's event plan. Also on
	 * client navigation (a chat card linking here while the Kitchen is open), but only when the link changes, so a
	 * later kitchen switch is not undone.
	 */
	let linkedSeen: string | null = null;
	$effect(() => {
		const linked = page.url.searchParams.get('plan');
		if (!linked || linked === linkedSeen) return;
		linkedSeen = linked;
		untrack(() => void k.load(linked).then(honourDeepLink));
	});

	/** Leave a link that didn't resolve: drop it from the address and open the kitchen's own plan. */
	async function openOwn() {
		await goto(resolve('/'), { replaceState: true });
		k.linkMissing = null;
		linkedSeen = null;
		await k.load();
	}

	onMount(() => {
		if (!new URL(location.href).searchParams.get('plan')) k.load().then(honourDeepLink);
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
	// Rescues start collapsed: one sentence on the row, the ranked options behind "See the options".
	const open = $derived(toggled);

	/** Phone zones (Decide / Plan / Order); desktop shows all three. Decide first while anything needs the chef. */
	const ZONES = [
		{ id: 'decide', label: 'Decide' },
		{ id: 'plan', label: 'Plan' },
		{ id: 'order', label: 'Order' }
	] as const;
	type Zone = (typeof ZONES)[number]['id'];
	let zone = $state<Zone | null>(null);
	function show(z: Zone) {
		zone = z;
		document.getElementById('zones')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	const snap = $derived(k.snap);
	/** The latest change to this plan, before → after, from the two snapshots (not from copy). */
	const changed = $derived(
		k.changeFrom && k.snap
			? planDiff(
					{ plan: k.changeFrom.plan, approval: k.changeFrom.approval },
					{ plan: k.snap.plan, approval: k.snap.approval }
				)
			: null
	);
	const amt = (v: number) => fixed(v, v < 10 ? 2 : 1);
	/** A dish whose rescue the contention split: its ranked summary predates the split, so it isn't repeated. */
	const contendedIn = (d: DishView) =>
		!!k.snap?.contentionRescue &&
		linesOf(d).some((l) => l.productName === k.snap!.contentionRescue!.productName);
	/** What the agent did when another kitchen took stock, in one sentence from the server's record of it. */
	const contended = $derived.by(() => {
		const c = k.snap?.contentionRescue;
		if (!c) return null;
		const added = c.added
			.map((a) => `${a.physical ?? `${num(a.qty)} ${a.unit.toLowerCase()}`} of ${a.name}`)
			.join(' and ');
		return `Another kitchen took ${c.taken} × ${c.productName}: ${c.left} are left of the ${c.had} the plan needed. I kept ${c.left}${
			added ? ` and added ${added}` : ''
		}${c.signOff ? '; that part needs your sign-off' : ''}. Nothing is ordered.`;
	});
	/** The booking's menu by dish name (a dish with two needs, rice and milk, is one dish). */
	const preMenu = [...new Set(SEED.dishes.map((d) => d.dish.split(' (')[0]))];
	/** The booking's products Valio could not supply at the last catalogue check (seed), for the pre-plan card. */
	const preOutages = SEED.dishes
		.filter((d) => d.availability?.kind === 'out' || d.availability?.kind === 'undeliverable')
		.map((d) => ({
			dish: d.dish.split(' (')[0],
			productId: d.productId,
			productName: d.productName,
			kind: d.availability!.kind
		}));

	// The dock asked to show this plan's decisions: Decide zone on a phone, then the approval panel in view.
	let locatedAt = 0;
	$effect(() => {
		const l = shell?.locate;
		if (!l || l.at === locatedAt || l.planId !== k.snap?.plan.id) return;
		locatedAt = l.at;
		untrack(() => {
			zone = l.zone ?? 'decide';
			void tick().then(() => {
				const card = l.decision
					? document.querySelector<HTMLElement>(`[data-decision="${CSS.escape(l.decision)}"]`)
					: null;
				const target = card ?? document.getElementById(l.zone === 'order' ? 'order' : 'approval');
				target?.scrollIntoView({ behavior: 'smooth', block: card ? 'center' : 'start' });
				// The exact card the dock pointed at shows itself once.
				card?.animate(
					[{ boxShadow: '0 0 0 4px var(--color-propose)' }, { boxShadow: '0 0 0 0 transparent' }],
					{ duration: 1600, easing: 'ease-out' }
				);
			});
		});
	});
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
	/** The seeded event plan (normal-week diff, buffet timeline), or a plan opened by link (an order, a menu). */
	const isEvent = $derived(!!plan?.eventId);
	const orderable = $derived.by(() => {
		const ls = (plan?.lines ?? []).filter((l) => l.view?.committable === true);
		return { lines: ls.length, cents: ls.reduce((a, l) => a + (l.lineCents ?? 0), 0) };
	});
	/** The next step leads: decide while anything needs the chef, then order (and its receipt), else the plan. */
	const active = $derived<Zone>(
		zone ?? (decisions.length ? 'decide' : orderable.lines || k.lastCommit ? 'order' : 'plan')
	);
	// Deciding the last decision moves the phone on to the next step instead of an empty Decide tab.
	$effect(() => {
		if (decisions.length === 0 && untrack(() => zone) === 'decide') zone = null;
	});
	/** Once every orderable line is ordered, the header becomes the order's state. */
	const orderedState = $derived.by(() => {
		const done = (plan?.lines ?? []).filter((l) => l.state === 'committed');
		const orders = snap?.orders ?? [];
		if (!done.length || orderable.lines > 0 || !orders.length) return null;
		// Every order on the plan (in-mandate lines may have gone first, approved ones later), from the receipts.
		const lines = orders.reduce((a, o) => a + o.output.committedLineIds.length, 0);
		const awaiting = orders.reduce((a, o) => a + o.output.awaitingSupplier.length, 0);
		return {
			confirmed: lines - awaiting,
			awaiting,
			cents: orders.reduce((a, o) => a + o.output.totalCents, 0)
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
		// The agent dock is scoped to this kitchen and the plan on screen.
		shell.chat = { kitchenId: snap?.kitchen.id, planId: snap?.plan.id };
		shell.kitchen = k;
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
			shell.chat = {};
			shell.kitchen = null;
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
			<b class="font-medium">Opened by link</b>
			<span class="text-ink-2"
				>{snap.kitchen.name.replace(' (fictional)', '')}{fromOps.need
					? ` · ${view?.dishes.find((d) => d.needId === fromOps!.need)?.nameFi ?? fromOps.need}`
					: ''}</span
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

{#if k.started !== true && (k.opening || k.linkMissing)}
	<!-- An approval link never lands on the start screen: wait for its plan, or say plainly it isn't here. -->
	<main class="mx-auto max-w-[720px] px-4 py-14 md:px-6" aria-busy={!!k.opening}>
		{#if k.opening}
			<p class="flex items-center gap-2 text-body text-ink-2" role="status">
				<LoaderCircle size={15} class="animate-spin text-accent" aria-hidden="true" />
				Opening the linked plan…
			</p>
		{:else}
			<h1 class="text-title font-semibold text-ink">This link's plan isn't in your sandbox</h1>
			<p class="mt-2 max-w-[60ch] text-body leading-relaxed text-ink-2">
				The link names a plan this browser's sandbox doesn't have. It may belong to another sandbox,
				or the sandbox was started over since the link was made.
			</p>
			<button
				type="button"
				class="mt-5 inline-flex h-11 items-center rounded-md border border-rule-strong px-4 text-body font-medium text-ink hover:bg-well"
				onclick={openOwn}>Open this kitchen's plan</button
			>
		{/if}
	</main>
{:else if k.started === false}
	{@const kit = KITCHENS.find((x) => x.id === k.startKitchen) ?? KITCHENS[0]}
	<main class="mx-auto max-w-[760px] px-4 py-10 md:px-6 md:py-14">
		<p class="text-meta text-ink-3">
			{kit.name.replace(' (fictional)', '')} · a booking to buy for
		</p>
		<h1 class="mt-1 text-title font-semibold tracking-[-0.015em] text-ink">{SEED.title}</h1>
		<p class="mt-1 text-body text-ink-2">
			{day(SEED.date)} · {SEED.guests.estimate} guests · {SEED.serviceStyle} · {preMenu.length}
			dishes
		</p>
		<ul class="mt-3 flex flex-wrap gap-1.5" aria-label="Menu">
			{#each preMenu as d (d)}
				<li class="rounded-full bg-well px-2 py-0.5 text-meta text-ink-2">{d}</li>
			{/each}
		</ul>

		<section
			class="mt-6 rounded-lg border border-rule bg-sheet px-4 py-3.5"
			aria-labelledby="out-h"
		>
			<h2 id="out-h" class="text-heading font-semibold text-ink">
				{preOutages.length} of these Valio can't supply as listed
			</h2>
			<ul class="mt-2 space-y-1.5">
				{#each preOutages as o (o.productId)}
					<li class="flex items-start gap-2 text-body text-ink">
						<CircleX size={16} class="mt-0.5 shrink-0 text-sup-missing" aria-hidden="true" />
						<span
							><span class="font-medium">{o.dish}</span>: {o.productName}
							<span class="mono text-meta text-ink-3">{o.productId}</span>
							<span class="text-ink-2"
								>· {o.kind === 'out' ? 'out of stock' : "Valio can't deliver it"}</span
							></span
						>
					</li>
				{/each}
			</ul>
			<p class="mt-2 text-meta text-ink-3">
				From Valio's catalogue at the last check; planning asks Valio again for every product.
			</p>
		</section>

		<blockquote class="mt-4 border-l-2 border-accent pl-3 text-body text-ink">
			“{kit.mandate.words}”
			<footer class="mt-1 text-meta text-ink-3">
				The chef's mandate: what the agent may do alone.
			</footer>
		</blockquote>

		<p class="mt-5 max-w-[62ch] text-body leading-relaxed text-ink-2">
			Planning turns menu × guests into Valio lines, and the agent proposes a rescue for each
			product above, within the mandate. Nothing is ordered until you approve.
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
	{#snippet lineRow(l: Line, d: DishView, inGroup = false)}
		<LineRow
			line={l}
			name={names.get(l.productId) ?? l.productId}
			approved={approvedIds.has(l.id)}
			flash={k.flash.has(l.id)}
			by={inGroup ? undefined : snap?.byAgent?.[l.id]}
			replaces={l.substituteFor && !inGroup
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
		class="mx-auto grid max-w-[1440px] grid-cols-1 gap-6 px-4 pt-5 pb-32 md:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:pb-10"
	>
		<div class="min-w-0">
			<!-- The task: decisions left, by when, cover by certainty; the event as a diff of a normal week -->
			<section aria-label="This task">
				<TaskHeader
					title={view.title}
					meta={isEvent
						? `${day(view.date)} · ${view.guests} guests · ${view.serviceStyle} · delivery ${day(plan.deliverBy)}`
						: `Delivery ${day(plan.deliverBy)}`}
					decisions={decisions.length}
					due={decisionsDue(plan, approval)}
					now={k.now}
					coverage={[...coverage.values()]}
					cannot={needsYou.cannot}
					{orderable}
					ordered={orderedState}
					others={(snap?.others ?? []).map((o) => ({
						...o,
						href: `${resolve('/')}?kitchen=${snap!.kitchen.id}&plan=${o.id}`
					}))}
				>
					{#snippet action()}
						{#if decisions.length && active !== 'decide'}
							<button
								type="button"
								class="inline-flex h-10 items-center gap-1.5 rounded-md bg-ink px-4 text-body font-medium text-sheet hover:bg-ink-2 lg:hidden"
								onclick={() => show('decide')}
								>Review {decisions.length === 1 ? 'the decision' : 'decisions'}</button
							>
						{/if}
					{/snippet}
				</TaskHeader>
				{#if isEvent}<p class="mt-2 text-meta text-ink-2">
						A normal week <span class="mono">{money(view.normalWeek.cents, { whole: true })}</span>
						({view.normalWeek.lines} lines) → this week
						<span class="mono text-ink">{money(view.thisWeek.cents, { whole: true })}</span>
						({view.thisWeek.lines} lines): the event adds
						<span class="mono text-ink"
							>{moneyDelta(view.thisWeek.cents - view.normalWeek.cents)}</span
						>
						and <span class="mono">{fixed(view.eventKg)}</span> kg of food.
					</p>{/if}
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

			<!-- Phone: one zone at a time, Decide first while anything needs the chef -->
			<div
				id="zones"
				role="tablist"
				aria-label="Task zones"
				class="sticky top-0 z-20 -mx-4 mt-4 flex border-b border-rule bg-paper/95 px-4 backdrop-blur lg:hidden"
			>
				{#each ZONES as z (z.id)}
					<button
						type="button"
						role="tab"
						aria-selected={active === z.id}
						class="flex h-11 flex-1 items-center justify-center gap-1.5 border-b-2 text-body {active ===
						z.id
							? 'border-ink font-semibold text-ink'
							: 'border-transparent text-ink-2'}"
						onclick={() => show(z.id)}
						>{z.label}{#if z.id === 'decide' && decisions.length}<span
								class="mono grid size-5 place-items-center rounded-full bg-auth text-micro text-sheet"
								>{decisions.length}</span
							>{/if}</button
					>
				{/each}
			</div>

			<!-- Plan: dish → need → order -->
			<section aria-labelledby="dishes-h" class="mt-6 {active === 'plan' ? '' : 'max-lg:hidden'}">
				<div class="flex items-baseline justify-between gap-4">
					<h2 id="dishes-h" class="text-heading font-semibold text-ink">Menu → need → order</h2>
					<p class="hidden text-meta text-ink-3 md:block">
						Change grams per guest and the order recomputes: need, lots, price, mandate.
					</p>
				</div>
				{#if contended}
					<p
						class="mt-2 flex items-start gap-2 rounded-lg border border-signoff/50 bg-signoff-wash px-4 py-2.5 text-body text-ink"
						role="status"
					>
						<Bot size={16} class="mt-0.5 shrink-0 text-signoff" aria-hidden="true" />
						<span>{contended}</span>
					</p>
				{/if}
				{#if changed}
					<section
						class="mt-2 rounded-lg border border-accent/40 bg-accent-wash/50 px-4 py-2.5"
						aria-label="What changed"
					>
						<div class="flex items-baseline justify-between gap-3">
							<p class="text-body font-semibold text-ink">
								What changed
								<span class="mono text-meta font-normal text-ink-3"
									>v{changed.from} → v{changed.to}</span
								>
							</p>
							<button
								type="button"
								class="text-meta text-ink-2 underline underline-offset-2 hover:text-ink"
								onclick={() => (k.changeFrom = null)}>Dismiss</button
							>
						</div>
						<ul class="mt-1 space-y-0.5 text-meta text-ink-2">
							{#each changed.needs as n (n.label)}
								<li>
									<span class="text-ink">{n.label.split(' (')[0]}</span> needs
									<span class="mono">{amt(n.before)} → {amt(n.after)} {n.unit}</span>
								</li>
							{/each}
							{#each changed.lines.slice(0, 4) as l (l.lineId)}
								<li>
									<span class="text-ink">{l.name}</span>
									{#if l.before === null}<span
											>added, <span class="mono">{num(l.after!)} {l.unit}</span></span
										>{:else if l.after === null}<span>dropped</span
										>{:else if l.before === l.after}<span
											>stays <span class="mono">{num(l.after)} {l.unit}</span></span
										>{:else}<span class="mono">{num(l.before)} → {num(l.after)} {l.unit}</span>{/if}
									{#if l.before !== l.after && snap?.byAgent?.[l.lineId]}
										· <AgentMark by={snap.byAgent[l.lineId]} />{/if}
								</li>
							{/each}
							{#if changed.lines.length > 4}<li>and {changed.lines.length - 4} more lines</li>{/if}
							<li>
								Plan <span class="mono"
									>{money(changed.cents.before)} → {money(changed.cents.after)}</span
								>
								· decisions
								<span class="mono">{changed.decisions.before} → {changed.decisions.after}</span>
							</li>
						</ul>
					</section>
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
									{#if d.name !== d.nameFi}<p class="text-meta text-ink-3">{d.name}</p>{/if}
								</div>
								<div class="col-span-2 flex items-start gap-3 lg:col-span-1">
									<!-- A direct need (an amount someone asked for) has no grams per guest to step. -->
									{#if d.gDefault > 0}<GramsStepper
											value={d.gServed}
											original={d.gDefault}
											label={d.nameFi}
											pending={k.pendingGrams[d.id]}
											disabled={k.readOnly || !d.editable || !!orderedState}
											onchange={(g) => k.setGrams(d.id, g)}
										/>{/if}
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
											{needUnit(d.need.unit)}{coverage.get(d.needId)?.basis === 'served'
												? ' to buy'
												: ''}
										</p>
										{#if coverage.get(d.needId)?.basis === 'served'}
											{@const fv = coverage.get(d.needId)!}
											<!-- What reaches the plate (bought × yield): the amount rescues and cover are compared on. -->
											<p class="text-meta text-ink-2">
												<span class="mono"
													>{fixed(fv.required.value, fv.required.value < 10 ? 2 : 1)}</span
												>
												{fv.required.unit} served
											</p>
										{/if}
										{#if d.needFormula !== `${d.need.value} ${d.need.unit}`}<p
												class="text-micro leading-snug text-ink-3"
											>
												{d.needFormula}
											</p>{/if}
										<p class="mt-0.5 text-micro text-ink-3 {isEvent ? '' : 'hidden'}">
											{#if d.usual}normal week {num(d.usual.qty)} {d.usual.unit}{:else}<span
													class="rounded-sm bg-well px-1 text-ink-2"
													title="Bought only for this event: the kitchen's normal week has none of it"
													>event only · not in a normal week</span
												>{/if}
										</p>
									</div>
								</div>
								<ul class="col-span-2 space-y-2 lg:col-span-1">
									{#each groupLines(lines) as g (g.key)}
										{#if g.make}
											<li>
												<StrategyCard
													by={g.lines.map((l) => snap?.byAgent?.[l.id]).find(Boolean)}
													title={d.nameFi}
													lines={g.lines}
													replaces={g.lines[0]?.substituteFor
														? {
																name:
																	names.get(g.lines[0].substituteFor) ?? g.lines[0].substituteFor,
																because:
																	d.outage === 'undeliverable'
																		? "Valio can't deliver it"
																		: 'out of stock at Valio'
															}
														: undefined}
												>
													{#snippet row(l)}{@render lineRow(l, d, true)}{/snippet}
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
										<DishStatus f={coverage.get(d.needId)!} gate={dishGate(lines)} />
									</div>
								</div>
							{/if}
							{#if d.rescue}
								<div class="px-4 pb-3">
									{#if !open[d.id]}
										<p class="mb-1.5 text-body leading-snug text-ink">
											<span class="font-medium"
												>{d.outage === 'out'
													? 'Out of stock at Valio.'
													: "Valio can't deliver it."}</span
											>
											{contendedIn(d)
												? 'Another kitchen took some of the rescue; the agent split it (above).'
												: d.rescue.summary}
										</p>{/if}
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
										{open[d.id] ? 'Hide the options' : 'See the options'} ·
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
			<div class={active === 'decide' ? '' : 'max-lg:hidden'}>
				<ApprovalPanel
					part="decide"
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
			</div>
			<div class="space-y-4 {active === 'order' ? '' : 'max-lg:hidden'}">
				<ApprovalPanel
					part="order"
					{plan}
					{approval}
					lastInvalidated={null}
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
				<!-- The scenario timeline pins the Christmas buffet: only the event plan has it. -->
				<div class={isEvent ? '' : 'hidden'}>
					<CutoffTimeline
						now={k.now}
						stock={openLines.stock}
						terminal={openLines.terminal}
						committed={openLines.stock + openLines.terminal === 0 && view.counts.committed > 0}
					/>
				</div>
			</div>
			<div class="{active === 'plan' ? '' : 'max-lg:hidden'} {isEvent ? '' : 'hidden'}">
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
			</div>
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
				<section
					aria-labelledby="log-h"
					class="{active === 'order'
						? ''
						: 'max-lg:hidden'} rounded-lg border border-rule bg-sheet px-4 py-3"
				>
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

	{#if decisions.length && active !== 'decide'}
		<button
			type="button"
			class="fixed inset-x-3 bottom-3 z-30 flex h-12 items-center justify-between rounded-lg bg-ink px-4 text-body font-medium text-sheet shadow-[0_8px_24px_-8px_oklch(0.2_0.02_255/0.5)] lg:hidden"
			onclick={() => show('decide')}
		>
			<span>{decisionCount(decisions.length)} before {storyTime(decisionsDue(plan, approval))}</span
			>
			<span>Review</span>
		</button>
	{/if}

	<WhyDrawer
		open={!!whyLine}
		line={whyLine}
		productName={whyLine ? (names.get(whyLine.productId) ?? whyLine.productId) : ''}
		dishName={whyDish ? `${whyDish.nameFi} (${whyDish.name})` : ''}
		steps={k.whySteps}
		{chain}
		coverage={whyLine?.needId ? (coverage.get(whyLine.needId) ?? null) : null}
		onclose={() => k.closeWhy()}
	/>
{/if}
