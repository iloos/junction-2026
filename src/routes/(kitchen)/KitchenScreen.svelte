<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		Ban,
		Bot,
		ChefHat,
		ChevronDown,
		CornerDownRight,
		Play,
		CloudOff,
		LoaderCircle,
		CircleX,
		Info
	} from '@lucide/svelte';
	import { KitchenStore } from '$lib/kitchen/kitchen.svelte';
	import { KITCHENS, PRODUCTS, SEED } from '$lib/kitchen/catalog';
	import { eventFor, type EventSeedFile } from '$lib/kitchen/events';
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
	import DishChip from '$lib/ui/DishChip.svelte';
	import DietMarks from '$lib/ui/DietMarks.svelte';
	import { CODES, CODE_WORDS, marksOf, marksTitle, rollUp } from '$lib/ui/diet';
	import CalendarSubscribe from '$lib/ui/CalendarSubscribe.svelte';
	import AgentMark from '$lib/ui/AgentMark.svelte';
	import { planDiff } from '$lib/ui/plan-diff';
	import { planOf } from '$lib/ui/shell/plan-events.svelte';
	import { describeOps } from '$lib/ui/chat/turn-view';
	import { dishGate } from '$lib/ui/coverage';
	import { whyChain } from '$lib/ui/why-chain';
	import { day, fixed, money, moneyDelta, num, readableName, storyTime } from '$lib/ui/format';
	import { SCENARIO } from '$lib/core/scenario';
	import { reasonShort } from '$lib/ui/reasons';
	import RescueCompare from '$lib/ui/RescueCompare.svelte';
	import RulesPanel from './RulesPanel.svelte';
	import ApprovalPanel, { type Shortfall } from './ApprovalPanel.svelte';
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
		expanded = { ...expanded, [dish.id]: true };
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

	// Names from the server's lines first, the fixture catalogue as a fallback; as people read them (the catalogue's
	// normalised short name, else Valio's ALL-CAPS name in sentence case). The raw name stays in Why.
	const names = $derived(
		new Map(
			[
				...Object.values(PRODUCTS).map((p) => [p.productId, p.name] as const),
				...(k.plan?.lines ?? [])
					.filter((l) => l.productName)
					.map((l) => [l.productId, l.productName!] as const)
			].map(([id, raw]) => [id, readableName(raw, k.snap?.shortNames?.[id])] as const)
		)
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
	/** Lines no dish row shows (an order of loose lines), so nothing on the plan is left off the table. */
	const looseLines = $derived.by(() => {
		const shown = new Set((k.view?.dishes ?? []).flatMap((d) => d.lineIds));
		return (k.plan?.lines ?? []).filter((l) => !shown.has(l.id) && l.qty.value > 0);
	});
	// The page and the dock stay in step: a change to this plan made elsewhere (the dock, a chat turn, an outside
	// agent) re-reads it once per burst, and What changed says who made it. The page's own commands re-read anyway.
	$effect(() => {
		if (!shell || k.mode !== 'live') return;
		return shell.events.subscribe((ops) => {
			const here = k.plan?.id;
			const mine = ops.filter((o) => here && planOf(o.op) === here && !/^kitchen\b/.test(o.via));
			if (!mine.length) return;
			const by = mine.some((o) => /^dock\b/.test(o.via))
				? 'dock'
				: mine.some((o) => /^(chat|task)\b/.test(o.via))
					? 'agent'
					: 'outside';
			void k.refreshFrom(by, describeOps(mine));
		});
	});
	const CHANGE_BY = {
		dock: 'by you in the agent dock',
		agent: 'by the agent in chat',
		outside: 'by an outside agent'
	} as const;

	/** Diet marks from each product's own record (lib/ui/diet): the line, its dish, the whole order. */
	const lineMarks = (l: Line) => marksOf(k.snap?.diet?.[l.productId]);
	const liveLines = (ls: readonly Line[]) =>
		ls.filter((l) => l.state !== 'rejected' && l.state !== 'unorderable' && l.qty.value > 0);
	const dishMarks = (ls: Line[]) => rollUp(liveLines(ls).map(lineMarks));
	const orderMarks = $derived(rollUp(liveLines(k.plan?.lines ?? []).map(lineMarks)));

	/** Who made the plan on screen, in words, for a plan that isn't the booking (its CreatePlan op). */
	const ORIGIN: Record<string, string> = {
		chat: 'Drafted by the agent in chat',
		request: 'From a purchase request',
		outside_agent: 'Prepared by an outside agent',
		kitchen: 'Planned in the Kitchen'
	};
	const originWords = $derived(k.snap?.origin ? (ORIGIN[k.snap.origin] ?? '') : '');
	const weekday = (iso: string) =>
		new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(
			new Date(`${iso}T12:00:00Z`)
		);
	/** The table names what it is: the event, its dishes, guests and day (the flow is behind the ⓘ). */
	const tableTitle = $derived.by(() => {
		const v = k.view;
		if (!v) return 'Dishes';
		const dishes = new Set(v.dishes.map((d) => d.nameFi.split(':')[0])).size;
		if (k.snap?.plan.eventId)
			return `${v.title.split(',')[0]} · ${dishes} dishes · ${num(v.guests)} guests · ${day(v.date)}`;
		// Not a booking: what this order buys and when, whoever made it (the header says who).
		const n = v.dishes.length + looseLines.length;
		return `${n} ${n === 1 ? 'item' : 'items'} · delivery ${day(k.snap!.plan.deliverBy)}`;
	});
	/** A shared demo room: others see what is typed here (the loader says so; null in your own sandbox). */
	const roomNotice = $derived(
		(page.data as { room?: { notice?: string | null } }).room?.notice ?? null
	);
	/** Why a link didn't land exactly where it pointed, if it didn't. */
	const linkNote = $derived.by(() => {
		if (!fromOps || !snap) return null;
		if (fromOps.ws && snap.clock?.workspaceId && fromOps.ws !== snap.clock.workspaceId)
			return 'The link is from another sandbox, which only its own browser can open; showing yours.';
		if (fromOps.run && snap.clock?.runId && fromOps.run !== snap.clock.runId)
			return 'The link is from before this sandbox was started over; showing the current plan.';
		if (fromOps.plan && fromOps.plan !== snap.plan.id)
			return "The link points to a plan this sandbox doesn't have; showing this kitchen's plan.";
		if (Number.isFinite(fromOps.v) && fromOps.v !== snap.plan.version)
			return `The plan changed since the link was made (v${fromOps.v} → v${snap.plan.version}). Check what changed before acting.`;
		return null;
	});
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
			.map(
				(a) => `${a.physical ?? `${num(a.qty)} ${a.unit.toLowerCase()}`} of ${readableName(a.name)}`
			)
			.join(' and ');
		return `Another kitchen took ${c.taken} × ${readableName(c.productName)}: ${c.left} are left of the ${c.had} the plan needed. I kept ${c.left}${
			added ? ` and added ${added}` : ''
		}${c.signOff ? '; that part needs your sign-off' : ''}. Nothing is ordered.`;
	});
	/** The event this kitchen would plan (its own seed, keyed by kitchen), for the screen before the first plan. */
	type SeedDish = EventSeedFile['dishes'][number] & {
		productName?: string;
		availability?: { kind?: string };
	};
	/** The kitchen's own seed (menu and outages), when this browser has it. */
	const preSeed = $derived(eventFor(k.startKitchen ?? 'k-hotel'));
	/**
	 * What the screen says before the first plan: the server's event for this kitchen when it names one, else the
	 * kitchen's seed. Null: the kitchen has no event, and its first plan comes from the chat.
	 */
	const preEvent = $derived.by(() => {
		if (k.startEvent === null) return null;
		const e = k.startEvent;
		const seed = preSeed ?? (k.startEvent === undefined ? (SEED as EventSeedFile) : undefined);
		return {
			title: e?.title ?? seed?.title ?? '',
			date: e?.date ?? seed?.date ?? '',
			guests: e?.guests ?? seed?.guests.estimate ?? 0,
			serviceStyle: e?.serviceStyle ?? seed?.serviceStyle ?? '',
			dishes: (seed?.dishes ?? []) as SeedDish[]
		};
	});
	/** The booking's menu by dish name (a dish with two needs, rice and milk, is one dish). */
	const preMenu = $derived([
		...new Set((preEvent?.dishes ?? []).map((d) => d.dish.split(' (')[0]))
	]);
	/** The booking's products Valio could not supply at the last catalogue check (seed), for the pre-plan card. */
	const preOutages = $derived(
		(preEvent?.dishes ?? [])
			.filter((d) => d.availability?.kind === 'out' || d.availability?.kind === 'undeliverable')
			.map((d) => ({
				dish: d.dish.split(' (')[0],
				productId: d.productId,
				productName: d.productName ?? d.productId,
				kind: d.availability!.kind
			}))
	);

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
	/**
	 * What the order still won't cover, grouped by why, each group one sentence with its items as chips: lines on
	 * stock Valio doesn't state (and, when they are all one-tap approvals, the tap), then needs nothing covers.
	 * From the server's coverage partition (F12/F15) and the lines' own supply certainty.
	 */
	const shortfalls = $derived.by((): Shortfall[] => {
		const out: Shortfall[] = [];
		const lines = (plan?.lines ?? []).filter(
			(l) =>
				l.state !== 'committed' &&
				l.state !== 'rejected' &&
				l.state !== 'unorderable' &&
				l.qty.value > 0 &&
				(l.view?.unknownStockCover.value ?? 0) > 0
		);
		if (lines.length) {
			const pending = new Set(approval?.state === 'pending' ? approval.lineIds : []);
			const oneTap = lines.every((l) => pending.has(l.id) && l.tier === 'propose');
			const n = lines.length;
			out.push({
				kind: 'unstated',
				sentence: `${n} ${n === 1 ? 'line' : 'lines'} ${
					oneTap
						? 'wait for one tap'
						: lines.every((l) => l.view?.committable)
							? n === 1
								? 'is approved, not ordered yet'
								: 'are approved, not ordered yet'
							: 'wait for a decision'
				}: Valio doesn't state a quantity, so ${n === 1 ? 'it is' : 'they are'} not counted as cover`,
				items: lines.map((l) => ({
					id: l.id,
					name: names.get(l.productId) ?? l.productId,
					qty: `${num(l.qty.value)} ${l.qty.unit}`
				})),
				approve: oneTap ? lines.map((l) => l.id) : undefined
			});
		}
		const label = (id: string) => view?.dishes.find((d) => d.needId === id)?.nameFi ?? id;
		const m = (v: number, u: string) => `${num(v, v < 10 ? 2 : 1)} ${u}`;
		const missing = [...coverage.values()].filter((f) => f.unresolved.value > 0);
		if (missing.length)
			out.push({
				kind: 'uncovered',
				sentence: `${missing.length} ${missing.length === 1 ? 'need has' : 'needs have'} nothing covering part of it`,
				items: missing.map((f) => ({
					id: f.needId,
					name: label(f.needId),
					qty: m(f.unresolved.value, f.unresolved.unit)
				}))
			});
		if (!coverage.size)
			for (const d of view?.dishes ?? [])
				if (d.rescue?.residual || d.status === 'shortfall')
					out.push({
						kind: 'uncovered',
						sentence: `${d.nameFi}: ${d.rescue?.residual?.text ?? 'no option qualifies'}`,
						items: []
					});
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
		if (!done.length || !orders.length) return null;
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

	/** Fixed columns so €, state and the expand control line up across rows (desktop). */
	const ROW_COLS = 'lg:grid-cols-[minmax(0,1fr)_112px_84px_minmax(0,1.5fr)_88px_172px_28px]';
	let expanded = $state<Record<string, boolean>>({});
	/** One row's product cell: what the dish buys now, in one line, and what it costs. */
	function rowOf(d: DishView, lines: Line[]) {
		const live = lines.filter(
			(l) => l.state !== 'rejected' && l.state !== 'unorderable' && l.qty.value > 0
		);
		const cents = live.reduce((t, l) => t + (l.lineCents ?? 0), 0);
		const made = live.filter((l) => l.strategy?.kind === 'make_in_house');
		const by = live.map((l) => snap?.byAgent?.[l.id]).find(Boolean);
		// Why the row isn't the planned product, from the replaced line and the rescue: said on the collapsed row.
		const replacedId = (made[0] ?? live.find((l) => l.substituteFor))?.substituteFor;
		const was = replacedId ? (names.get(replacedId) ?? replacedId) : null;
		const cause = d.outage === 'undeliverable' ? "Valio can't deliver it" : 'out at Valio';
		const changes = (id: string) =>
			d.rescue?.candidates.find((c) => c.productId === id)?.whatChanges;
		if (made.length)
			return {
				kind: 'make' as const,
				product: `Make in house · ${made.length} ingredients`,
				more: 0,
				cents,
				by,
				was,
				cause,
				changes: null as string | null | undefined
			};
		const main = live.find((l) => l.substituteFor) ?? live[0];
		if (!main)
			return {
				kind: 'none' as const,
				product: `${names.get(lines[0]?.productId ?? '') ?? d.nameFi} · not orderable`,
				more: 0,
				cents,
				by,
				was: null,
				cause,
				changes: null as string | null | undefined
			};
		return {
			kind: main.substituteFor ? ('sub' as const) : ('buy' as const),
			product: names.get(main.productId) ?? main.productId,
			more: live.length - 1,
			cents,
			by,
			was: main.substituteFor ? was : null,
			cause,
			changes: main.substituteFor ? changes(main.productId) : null
		};
	}

	function linesOf(d: DishView): Line[] {
		return d.lineIds.map((id) => k.lineById.get(id)).filter((l): l is Line => !!l);
	}
	const needUnit = (u: string) => (u === 'pcs' ? 'pcs' : u);

	// The shell shows the sandbox (workspace, run, clock, start over) and where the data comes from.
	const shell = useShell();
	/**
	 * With the agent open and decisions waiting, the Decide panel lives at the top of the agent rail (the same panel
	 * and command), once, instead of beside the plan as well.
	 */
	const inRail = $derived(!!shell?.chatOpen && decisions.length > 0);
	$effect(() => {
		if (!shell) return;
		shell.railHeader = inRail && k.plan && k.snap ? decidePanel : null;
		return () => {
			if (shell.railHeader === decidePanel) shell.railHeader = null;
		};
	});

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
		{#if roomNotice}
			<p class="min-w-0 rounded-md bg-signoff-wash px-2 py-1 text-meta text-ink" role="note">
				{roomNotice}
			</p>
		{/if}
		{#if snap}
			<p class="max-w-[95ch] min-w-0 text-meta text-ink-2">
				<span class="font-medium text-ink">Mandate, in the chef's words:</span>
				“{snap.rules.words}”
			</p>
			<span class="sm:ml-auto"><CalendarSubscribe kitchenId={snap.kitchen.id} /></span>
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

{#if linkNote}
	<!-- Only when the link and what this browser shows disagree; a link that landed needs no banner. -->
	<div class="border-b border-signoff/40 bg-signoff-wash" role="status">
		<div
			class="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-body text-ink md:px-6"
		>
			<span>{linkNote}</span>
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
		{#if !preEvent}
			<!-- A kitchen without a booked event: its first plan comes from what the chef asks for. -->
			<p class="text-meta text-ink-3">{kit.name.replace(' (fictional)', '')}</p>
			<h1 class="mt-1 text-title font-semibold tracking-[-0.015em] text-ink">
				Nothing planned yet
			</h1>
			<p class="mt-2 max-w-[60ch] text-body leading-relaxed text-ink-2">
				This kitchen has no booked event. Its first plan comes from the chat: say what you need and
				for when, and the agent drafts it within your mandate.
			</p>
			<blockquote class="mt-4 border-l-2 border-accent pl-3 text-body text-ink">
				“{kit.mandate.words}”
				<footer class="mt-1 text-meta text-ink-3">
					The chef's mandate: what the agent may do alone.
				</footer>
			</blockquote>
			<button
				type="button"
				class="mt-5 inline-flex h-11 items-center gap-2 rounded-md bg-accent px-5 text-body font-medium text-sheet hover:bg-accent-ink"
				onclick={() => shell && (shell.chatOpen = true)}
			>
				<Bot size={16} aria-hidden="true" /> Ask the agent
			</button>
		{:else}
			<p class="text-meta text-ink-3">
				{kit.name.replace(' (fictional)', '')} · a booking to buy for
			</p>
			<h1 class="mt-1 text-title font-semibold tracking-[-0.015em] text-ink">{preEvent.title}</h1>
			<p class="mt-1 text-body text-ink-2">
				{day(preEvent.date)} · {num(preEvent.guests)} guests · {preEvent.serviceStyle}{preMenu.length
					? ` · ${preMenu.length} dishes`
					: ''}
			</p>
			<ul class="mt-3 flex flex-wrap gap-1.5" aria-label="Menu">
				{#each preMenu as d (d)}
					<li class="rounded-full bg-well px-2 py-0.5 text-meta text-ink-2">{d}</li>
				{/each}
			</ul>

			{#if preOutages.length}
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
			{/if}

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
		{/if}
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
	{#snippet lineRow(l: Line, d: DishView | null, inGroup = false)}
		<LineRow
			line={l}
			name={names.get(l.productId) ?? l.productId}
			approved={approvedIds.has(l.id)}
			flash={k.flash.has(l.id)}
			by={inGroup ? undefined : snap?.byAgent?.[l.id]}
			diet={lineMarks(l)}
			replaces={l.substituteFor && !inGroup
				? {
						name: names.get(l.substituteFor) ?? l.substituteFor,
						because:
							d?.outage === 'undeliverable' ? "Valio can't deliver it" : 'out of stock at Valio'
					}
				: undefined}
			onwhy={() => k.openWhy(l.id)}
		/>
	{/snippet}
	<main
		class="mx-auto grid max-w-[1440px] grid-cols-1 gap-6 px-4 pt-5 pb-32 md:px-6 lg:pb-10 {shell?.chatOpen
			? '2xl:grid-cols-[minmax(0,1fr)_360px]'
			: 'lg:grid-cols-[minmax(0,1fr)_360px]'}"
	>
		<div class="min-w-0">
			<!-- The task: decisions left, by when, cover by certainty; the event as a diff of a normal week -->
			<section aria-label="This task">
				<TaskHeader
					title={isEvent ? view.title : readableName(view.title)}
					meta={isEvent
						? `${day(view.date)} · ${num(view.guests)} guests · ${view.serviceStyle} · delivery ${day(plan.deliverBy)}`
						: [originWords, `delivery ${day(plan.deliverBy)}`].filter(Boolean).join(' · ')}
					decisions={decisions.length}
					due={decisionsDue(plan, approval)}
					now={k.now}
					coverage={[...coverage.values()]}
					cannot={needsYou.cannot}
					{orderable}
					ordered={orderedState}
					openLines={(plan?.lines ?? []).filter(
						(l) => !['committed', 'rejected', 'unorderable'].includes(l.state) && l.qty.value > 0
					).length}
					others={(snap?.others ?? []).map((o) => ({
						...o,
						title: readableName(o.title),
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
						{#if view.thisWeek.cents - view.normalWeek.cents > 0}
							The event adds
							<span class="mono text-ink"
								>{moneyDelta(view.thisWeek.cents - view.normalWeek.cents)}</span
							>
							and <span class="mono text-ink">{fixed(view.eventKg)}</span> kg of food to a normal week
						{:else}
							<!-- A regular service, not an extra: it is part of the normal week, so it adds nothing to it. -->
							An ordinary {weekday(view.date)}: inside the normal week
						{/if}
						<span class="text-ink-3"
							>(team estimate: <span class="mono"
								>{money(view.normalWeek.cents, { whole: true })}</span
							>, {view.normalWeek.lines} lines)</span
						>.
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
					<h2 id="dishes-h" class="flex items-center gap-1.5 text-heading font-semibold text-ink">
						{tableTitle}
						<details class="relative font-normal">
							<summary
								class="grid size-6 cursor-pointer list-none place-items-center rounded-full text-ink-3 hover:bg-well hover:text-ink"
								aria-label="How this table works"><Info size={15} aria-hidden="true" /></summary
							>
							<p
								class="absolute top-7 left-0 z-20 w-72 rounded-md border border-rule bg-sheet px-3 py-2 text-meta text-ink-2 shadow-md"
							>
								{#if isEvent}Menu → need → order. Change grams per guest and the need, packs, price
									and mandate recompute. Open a row for how the amount was worked out and every
									line; Why shows the sources.{:else}What this order buys, line by line. Open a row
									for its terms; Why shows where each fact came from and what the mandate says.{/if}
							</p>
						</details>
					</h2>
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
				{#if k.outsideNote}
					<p
						class="mt-2 flex items-start gap-2 rounded-lg border border-accent/40 bg-accent-wash/50 px-4 py-2 text-body text-ink"
						role="status"
					>
						<span class="min-w-0 flex-1"
							><span class="font-medium">{CHANGE_BY[k.outsideNote.by].replace(/^by/, 'By')}:</span>
							{k.outsideNote.text}</span
						>
						<button
							type="button"
							class="shrink-0 text-meta text-ink-2 underline underline-offset-2 hover:text-ink"
							onclick={() => (k.outsideNote = null)}>Dismiss</button
						>
					</p>
				{/if}
				{#if changed}
					<section
						class="mt-2 rounded-lg border border-accent/40 bg-accent-wash/50 px-4 py-2.5"
						aria-label="What changed"
					>
						<div class="flex items-baseline justify-between gap-3">
							<p class="text-body font-semibold text-ink">
								What changed{#if k.changeBy}<span class="font-normal text-ink-2">
										· {CHANGE_BY[k.changeBy]}</span
									>{/if}
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
						class="hidden {ROW_COLS} items-center gap-x-3 border-b border-rule bg-well px-4 py-2 text-micro font-medium text-ink-3 lg:grid"
						aria-hidden="true"
					>
						<span>{isEvent ? 'Dish' : 'Item'}</span>
						<span>{isEvent ? 'g per guest' : ''}</span>
						<span class="text-right">Need</span>
						<span>Product</span>
						<span class="text-right">€ ex VAT</span>
						<span>State</span>
						<span></span>
					</div>
					{#each view.dishes as d (d.id)}
						{@const lines = linesOf(d)}
						{@const f = coverage.get(d.needId)}
						{@const r = rowOf(d, lines)}
						{@const isOpen = !!expanded[d.id]}
						{@const lockedDish = lines.some((l) => l.state === 'committed')}
						<div
							id="need-{d.id}"
							class="scroll-mt-4 border-b border-rule last:border-b-0 {focusNeed === d.needId
								? 'bg-propose-wash/40 ring-2 ring-propose/50 ring-inset'
								: ''}"
						>
							<!-- One line per dish: everything else is in the detail below (expand) or in Why. -->
							<div
								class="grid min-h-16 grid-cols-[minmax(0,1fr)_auto_28px] items-center gap-x-3 px-4 py-2 lg:min-h-14 {ROW_COLS} {k.flash.has(
									d.plannedLineId
								) || k.flash.has(d.lineIds[1] ?? '')
									? 'landed'
									: ''}"
							>
								<div class="min-w-0">
									<p class="flex min-w-0 items-center gap-1.5 text-body font-medium text-ink">
										<span class="truncate">{d.nameFi}</span>
										<DietMarks marks={dishMarks(lines)} />
									</p>
									<p class="truncate text-meta text-ink-3">
										<span class="lg:hidden"
											>{#if r.was}<span class="text-signoff"
													>{r.cause.replace(/^./, (c) => c.toUpperCase())}</span
												>
												→ {r.product}{:else}{r.product}{/if}</span
										><span class="max-lg:hidden">{d.name !== d.nameFi ? d.name : ''}</span>
									</p>
								</div>
								<div class="hidden lg:block">
									{#if d.gDefault > 0}<GramsStepper
											compact
											value={d.gServed}
											original={d.gDefault}
											label={d.nameFi}
											pending={k.pendingGrams[d.id]}
											disabled={k.readOnly || !d.editable || lockedDish}
											onchange={(g) => k.setGrams(d.id, g)}
										/>{:else}<span class="text-meta text-ink-3">—</span>{/if}
								</div>
								<p class="mono hidden text-right text-body text-ink lg:block" title={d.needFormula}>
									{d.need.unit === 'pcs'
										? d.need.value
										: fixed(d.need.value, d.need.value < 10 ? 2 : 1)}
									<span class="text-meta text-ink-3">{needUnit(d.need.unit)}</span>
								</p>
								<!-- A 40 px product thumbnail can sit before the name here without growing the row. -->
								<div class="hidden min-w-0 lg:block">
									<p class="flex min-w-0 items-center gap-1.5 text-body">
										{#if r.kind === 'make'}<ChefHat
												size={14}
												class="shrink-0 text-accent"
												aria-hidden="true"
											/>{:else if r.kind === 'sub'}<CornerDownRight
												size={14}
												class="shrink-0 text-accent"
												aria-label="Replaces the planned product"
											/>{:else if r.kind === 'none'}<Ban
												size={14}
												class="shrink-0 text-sup-missing"
												aria-hidden="true"
											/>{/if}
										<span class="truncate {r.kind === 'none' ? 'text-ink-3' : 'text-ink'}"
											>{r.product}</span
										>
										{#if r.more}<span class="shrink-0 text-meta text-ink-3">+{r.more}</span>{/if}
										{#if r.by}<Bot
												size={13}
												class="shrink-0 text-propose"
												aria-label="by the agent"
											/>{/if}
									</p>
									{#if r.was}
										<!-- Why this isn't the planned product, on the row: what was replaced, the cause, what changes. -->
										<p class="truncate text-meta text-ink-2" title="{r.was}: {r.cause}">
											<span class="text-signoff"
												>{r.cause.replace(/^./, (c) => c.toUpperCase())}</span
											>{#if r.changes}
												&nbsp;· {r.changes}{/if} · replaces {r.was}
										</p>
									{/if}
								</div>
								<div class="flex flex-col items-end gap-1 lg:contents">
									<p class="mono text-right text-body text-ink">{r.cents ? money(r.cents) : '—'}</p>
									<div class="min-w-0">
										{#if f}<DishChip {f} gate={dishGate(lines)} rescued={r.kind !== 'buy'} />{/if}
									</div>
								</div>
								<button
									type="button"
									class="grid size-7 place-items-center rounded-md text-ink-2 hover:bg-well hover:text-ink"
									aria-expanded={isOpen}
									aria-controls="detail-{d.id}"
									aria-label="{isOpen ? 'Hide' : 'Show'} details: {d.nameFi}"
									onclick={() => (expanded = { ...expanded, [d.id]: !isOpen })}
									><ChevronDown
										size={16}
										class="transition-transform duration-200 {isOpen ? '' : '-rotate-90'}"
										aria-hidden="true"
									/></button
								>
							</div>
							{#if isOpen}
								<div
									id="detail-{d.id}"
									class="space-y-3 border-t border-rule bg-paper/50 px-4 py-3"
								>
									<div class="flex flex-wrap items-start gap-x-6 gap-y-2">
										{#if d.gDefault > 0}<div class="lg:hidden">
												<GramsStepper
													value={d.gServed}
													original={d.gDefault}
													label={d.nameFi}
													pending={k.pendingGrams[d.id]}
													disabled={k.readOnly || !d.editable || lockedDish}
													onchange={(g) => k.setGrams(d.id, g)}
												/>
											</div>{/if}
										<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-meta">
											<dt class="text-ink-3">To buy</dt>
											<dd class="mono text-ink">
												{fixed(d.need.value, d.need.value < 10 ? 2 : 1)}
												{needUnit(d.need.unit)}
											</dd>
											{#if f?.basis === 'served'}
												<dt class="text-ink-3">Served</dt>
												<dd class="mono text-ink">
													{fixed(f.required.value, f.required.value < 10 ? 2 : 1)}
													{f.required.unit}
												</dd>
											{/if}
											{#if d.needFormula !== `${d.need.value} ${d.need.unit}`}
												<dt class="text-ink-3">Worked out</dt>
												<dd class="mono text-ink-2">{d.needFormula}</dd>
											{/if}
											{#if d.gDefault > 0 && d.gServed !== d.gDefault}
												<dt class="text-ink-3">Planned</dt>
												<dd class="text-ink-2">{d.gDefault} g per guest</dd>
											{/if}
											{#if isEvent}
												<dt class="text-ink-3">Normal week</dt>
												<dd class="text-ink-2">
													{d.usual
														? `${num(d.usual.qty)} ${d.usual.unit}`
														: 'none: bought only for this event'}
												</dd>
											{/if}
										</dl>
									</div>
									{#if f}<DishStatus {f} gate={dishGate(lines)} />{/if}
									<ul class="space-y-2">
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
									{#if d.rescue}
										<div>
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
							{/if}
						</div>
					{/each}
					{#each looseLines as l (l.id)}
						<!-- A line with no dish behind it (an outside agent's or a request's order): the line itself is the row. -->
						<div id="line-{l.id}" class="border-b border-rule px-4 py-2 last:border-b-0">
							{@render lineRow(l, null)}
						</div>
					{/each}
				</div>
				{#if k.snap?.diet}
					<p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-2">
						<span class="font-medium text-ink">This order:</span>
						<DietMarks marks={orderMarks} />
						<span>{marksTitle(orderMarks)}</span>
					</p>
					<p class="mt-1 text-meta text-ink-3" aria-label="Diet marks legend">
						{CODES.map((c) => `${c} ${CODE_WORDS[c]}`).join(' · ')} · ? no allergen record (allergens
						unknown, never read as free from)
					</p>
				{/if}
				<p class="mt-2 text-meta leading-snug text-ink-3">
					{#if isEvent}Grams per guest, yields and recipes are team estimates.{/if} Prices are Valio catalogue
					prices ex VAT; lines where Valio doesn't state a quantity are ordered, but never counted as
					cover.
				</p>
			</section>
		</div>

		<!-- With the agent rail open the page is narrower: the panels go under the plan until there is room again. -->
		<aside
			class="space-y-4 {shell?.chatOpen
				? 'lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0 2xl:sticky 2xl:top-4 2xl:block 2xl:space-y-4 2xl:self-start'
				: 'lg:sticky lg:top-4 lg:self-start'}"
			aria-label="Rules and approval"
		>
			{#if !inRail}
				<div class={active === 'decide' ? '' : 'max-lg:hidden'}>
					{@render decidePanel()}
				</div>
			{/if}
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

<!-- The Decide panel: beside the plan, or at the top of the agent rail while the agent is open (one place). -->
{#snippet decidePanel()}
	{#if plan && snap}
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
	{/if}
{/snippet}
