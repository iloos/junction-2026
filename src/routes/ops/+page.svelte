<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import type { Plan, PlanView } from '$lib/core/contracts';
	import { SCENARIO, scenarioClock, scenarioDate } from '$lib/core/scenario';
	import { OpsStream } from './stream.svelte';
	import CaseTicket from './CaseTicket.svelte';
	import OpTimeline from './OpTimeline.svelte';
	import TraceDrawer from './TraceDrawer.svelte';
	import Queue from './Queue.svelte';
	import ProblemCard from './ProblemCard.svelte';
	import StoryPanel from './StoryPanel.svelte';
	import ServiceStatus from './ServiceStatus.svelte';
	import SponsorsPanel from './SponsorsPanel.svelte';
	import RoomView from './RoomView.svelte';
	import ForecastTab from './ForecastTab.svelte';
	import FlowTab from './FlowTab.svelte';
	import {
		lastIncident,
		lastShortage,
		orderFeed,
		roomKitchens,
		storesCreated,
		storeTotals
	} from './room';
	import { INCIDENT_LABEL } from './incidents';
	import OrdersTab from './OrdersTab.svelte';
	import DemandTab from './DemandTab.svelte';
	import GatePanel from './GatePanel.svelte';
	import { gatePaths } from './gate';
	import { storyOf } from './story';
	import type { OpEnvelope } from '$lib/core/contracts';
	import {
		buildCases,
		coverage,
		kitchenHref,
		openDecisions,
		openLines,
		pendingApprovalOf,
		withApprovals
	} from './cases';
	import { buildProblems, type Problem } from './problems';
	import {
		ACTOR,
		euro,
		opPlanId,
		opSummary,
		productName,
		SIM_KIND,
		viaLabel,
		type Names
	} from './labels';
	import { useShell } from '$lib/ui/shell/shell.svelte';

	let { data, form } = $props();

	let judgeKey = $state<string | null>(null);
	let judgeKeyNote = $state('Loading…');
	async function loadJudgeKey() {
		if (judgeKey) return;
		try {
			const r = await fetch('/api/demo/judge-key');
			const b = await r.json();
			if (r.ok) judgeKey = b.mcpUrl;
			else judgeKeyNote = b?.error?.message ?? `No key (HTTP ${r.status}).`;
		} catch (e) {
			judgeKeyNote = e instanceof Error ? e.message : String(e);
		}
	}

	// Workspace links reload the page (data-sveltekit-reload), so one stream per page load is enough.
	// svelte-ignore state_referenced_locally
	const stream = new OpsStream(data.workspace, data.copies ? `&copies=${data.copies}` : '');
	onMount(() => {
		stream.start();
		return () => stream.stop();
	});

	let tracesOpen = $state(false);
	let confirmReset = $state(false);
	// svelte-ignore state_referenced_locally
	const anchor = data.runStartedAt;
	let wall = $state(Date.now());
	onMount(() => {
		const t = setInterval(() => (wall = Date.now()), 15_000);
		return () => clearInterval(t);
	});
	/** Simulator events carry their own time; otherwise the scenario clock ticking from the run start. */
	const scenarioNow = $derived(
		data.simulated
			? stream.simClock
			: scenarioClock(stream.runStartedAt ?? anchor)
					.at(wall)
					.toISOString()
	);

	/** The op log flows with the page (no scroll inside a scroll); the newest LOG_SHOWN, the rest on request. */
	const LOG_SHOWN = 15;
	let logAll = $state(false);

	/** The kitchens the page loaded plus stores created since it opened (D24). */
	const kitchens = $derived(roomKitchens(data.kitchens, storesCreated(stream.roomSims)));
	const kitchenName = (id: string) => kitchens.find((k) => k.id === id)?.name ?? id;
	/** The shared room shows the room first. */
	const inRoom = $derived(data.room.kind === 'shared' || data.room.kind === 'full');
	const joinUrl = $derived(inRoom ? `${data.origin}${resolve('/')}?ws=${data.rooms.shared}` : null);
	const plans = $derived(Object.values(stream.state.plans));

	/**
	 * Plan views (fulfilment per need) from the server: the op stream carries plans, not their read model. Fetched
	 * once the stream is live and again at most every VIEWS_MS after ops arrive.
	 */
	const VIEWS_MS = 1500;
	let views = $state.raw<Record<string, PlanView>>({});
	/** Product names: the seeds at load, then every product the plans name, from the catalogue (/ops/views). */
	// svelte-ignore state_referenced_locally
	let names = $state.raw<Names>(data.names);
	let viewsTimer: ReturnType<typeof setTimeout> | null = null;
	async function loadViews() {
		viewsTimer = null;
		try {
			const r = await fetch(`/ops/views?ws=${encodeURIComponent(data.workspace)}`);
			if (r.ok) {
				const b = (await r.json()) as { views: Record<string, PlanView>; names?: Names };
				views = b.views;
				if (b.names && Object.keys(b.names).some((id) => names[id] !== b.names![id]))
					names = { ...names, ...b.names };
			}
		} catch {
			/* keep the last views; coverage says "not reported" until one arrives */
		}
	}
	$effect(() => {
		void stream.state;
		if (data.simulated || stream.status !== 'live' || viewsTimer) return;
		viewsTimer = setTimeout(loadViews, VIEWS_MS);
	});
	onMount(() => () => {
		if (viewsTimer) clearTimeout(viewsTimer);
	});
	const withView = (p: Plan): Plan => (views[p.id] ? { ...p, view: views[p.id] } : p);

	const planKitchen = (planId: string) => {
		const p = stream.state.plans[planId];
		return p ? kitchenName(p.kitchenId) : planId;
	};

	/**
	 * Problems (cards and their story, the first screen), queue (work surface), wallboard (one column per kitchen)
	 * or the engine room (timeline, op log and traces; shown with the System toggle). Remembered.
	 */
	type View =
		| 'room'
		| 'problems'
		| 'orders'
		| 'demand'
		| 'forecast'
		| 'flow'
		| 'queue'
		| 'wallboard'
		| 'engine';
	const shell = useShell();
	const system = $derived(!!shell?.system);
	let chosen = $state<View>('problems');
	const view = $derived<View>(chosen === 'engine' && !system ? 'problems' : chosen);
	onMount(() => {
		try {
			const saved = localStorage.getItem('ops-view');
			if (
				saved === 'room' ||
				saved === 'orders' ||
				saved === 'demand' ||
				saved === 'forecast' ||
				saved === 'flow' ||
				saved === 'queue' ||
				saved === 'wallboard' ||
				saved === 'engine'
			)
				chosen = saved;
			else if (inRoom) chosen = 'room';
		} catch {
			/* storage blocked: keep the default */
		}
	});
	const setView = (v: View) => {
		chosen = v;
		try {
			localStorage.setItem('ops-view', v);
		} catch {
			/* not remembered */
		}
	};
	/** The queue rebuilds at most every QUEUE_MS, so bursts of ops don't re-render 200 rows per frame. */
	const QUEUE_MS = 250;
	let cases = $state.raw<ReturnType<typeof buildCases>>([]);
	let problems = $state.raw<Problem[]>([]);
	let queueTimer: ReturnType<typeof setTimeout> | null = null;
	let queueDirty = false;
	$effect(() => {
		void stream.state;
		void stream.heldSince;
		void views;
		void names;
		queueDirty = true;
		if (queueTimer) return;
		const run = () => {
			queueTimer = null;
			if (!queueDirty) return;
			queueDirty = false;
			// Plans with their views, so an outage a rescue or commit has answered no longer shows as a case.
			const plansWithViews = Object.fromEntries(
				Object.entries(stream.state.plans).map(([id, p]) => [id, withView(p)])
			);
			// Approved lines read as approved (withApprovals), as the decision tiles count them.
			const withViews = withApprovals({ ...stream.state, plans: plansWithViews });
			cases = buildCases(withViews, names, stream.heldSince);
			problems = buildProblems(withViews, names, opsInOrder());
			queueTimer = setTimeout(run, QUEUE_MS);
		};
		run();
	});
	/** The current run's ops, oldest first. */
	const opsInOrder = () =>
		stream.log
			.filter((e): e is Extract<typeof e, { kind: 'op' }> => e.kind === 'op')
			.map((e) => e.envelope)
			.reverse();

	/** The problem whose story shows: the one picked, else the first. */
	let picked = $state<string | null>(null);
	const selected = $derived(problems.find((p) => p.id === picked) ?? problems[0] ?? null);
	const story = $derived(
		selected ? storyOf(selected, opsInOrder(), stream.state, names) : { steps: [], hidden: 0 }
	);
	/** The op a story step's "Technical detail" opens in the trace drawer. */
	let detailOp = $state<OpEnvelope | null>(null);
	function showOp(seq: number) {
		const e = stream.log.find((x) => x.kind === 'op' && x.seq === seq);
		if (e?.kind !== 'op') return;
		detailOp = e.envelope;
		tracesOpen = true;
	}

	/** "cut-off in 16 h" on the cases' clock; absolute times in the simulated run. */
	function span(ms: number): string {
		const m = Math.round(Math.abs(ms) / 60_000);
		if (m < 60) return `${m} min`;
		const h = Math.round(m / 60);
		return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
	}
	const cutoffIn = (iso: string | null) => {
		if (!iso) return null;
		const abs = simTime(iso);
		if (data.simulated) return { text: `cut-off ${abs}`, late: false, abs };
		const ms = new Date(iso).getTime() - new Date(caseNow).getTime();
		return ms < 0
			? { text: `cut-off passed ${span(ms)} ago`, late: true, abs }
			: { text: `cut-off in ${span(ms)}`, late: false, abs };
	};
	const linkAt = $derived(
		data.simulated ? undefined : { ws: data.workspace, run: stream.state.runId || data.run }
	);
	const problemHref = (p: Problem) => (p.at ? kitchenHref(p.at, linkAt) : null);

	/** "Now" on the cases' clock: op times are scenario time live, wall time in the simulated run. */
	const caseNow = $derived(
		data.simulated ? new Date(wall).toISOString() : (scenarioNow ?? new Date(wall).toISOString())
	);

	const columns = $derived(
		kitchens.map((k) => {
			const mine = plans.filter((p) => p.kitchenId === k.id);
			const held = mine.flatMap((p) => openLines(withView(p)).map((line) => ({ line, plan: p })));
			const orders = Object.values(stream.state.orders).filter((o) => o.kitchenId === k.id);
			const committed = orders.reduce((s, o) => s + o.totalCents, 0);
			const anomalies = Object.values(stream.state.anomalies).filter((a) =>
				mine.some((p) => p.id === a.planId)
			);
			const pending = mine.flatMap((p) => pendingApprovalOf(stream.state, p.id) ?? []);
			const external = mine.some((p) => p.createdBy.kind === 'external_agent');
			return {
				kitchen: k,
				plans: mine,
				held,
				orders,
				committed,
				anomalies,
				pending,
				external,
				cases: cases.filter((c) => c.kitchenId === k.id),
				cover: coverage(mine.map(withView))
			};
		})
	);
	const confirmedOf = (orderId: string) =>
		Object.values(stream.state.receipts).find((r) => r.orderId === orderId)?.confirmed.length ?? 0;

	const freshPlan = $derived.by(() => {
		const e = stream.log[0];
		return e?.kind === 'op' && e.seq === stream.fresh ? opPlanId(e.envelope) : undefined;
	});

	const totals = $derived.by(() => {
		// The kitchen's definitions (the task header): decisions are reason groups of the pending approvals
		// (decisionsOf); "can't be ordered" counts every product that is out or undeliverable, rescued or not;
		// "unresolved" counts needs whose plan view still has something no line covers.
		const all = plans.map(withView);
		const decisions = openDecisions(stream.state, all);
		const views = all.flatMap((p) => p.view?.fulfilment ?? []);
		return {
			decisions: decisions.length,
			signOff: decisions.filter((d) => d.signOff).length,
			cannot: all.flatMap((p) => p.lines).filter((l) => l.state === 'unorderable').length,
			unresolved: views.filter((f) => f.unresolved.value > 1e-9).length,
			needs: views.length,
			committed: Object.values(stream.state.orders).reduce((s, o) => s + o.totalCents, 0),
			refused: stream.state.failedCommits.length + stream.state.refusals.length
		};
	});

	const STATUS = {
		connecting: 'Connecting',
		live: 'Live',
		reconnecting: 'Reconnecting',
		polling: 'Polling',
		offline: 'Offline, retrying'
	} as const;

	const time = (iso: string) =>
		new Date(iso).toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	/** Hours and minutes on the scenario's clock (Helsinki), for the story. */
	const clockTime = (iso: string) =>
		new Date(iso).toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Europe/Helsinki'
		});
	const simTime = (iso: string) =>
		new Date(iso).toLocaleString('en-GB', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Europe/Helsinki'
		});
</script>

<svelte:head><title>Operations · Mandate</title></svelte:head>

<!-- eslint-disable svelte/no-navigation-without-resolve -- workspace links are query-only on this route, built from resolve('/ops') -->
<div class="room">
	<header>
		<div class="title">
			<h1>Operations</h1>
			<nav aria-label="Workspace">
				<a
					data-sveltekit-reload
					href={resolve('/ops') + '?ws=mine'}
					aria-current={data.workspace === data.room.own ? 'page' : undefined}>Your sandbox</a
				>
				<a
					data-sveltekit-reload
					href={resolve('/ops') + `?ws=${data.rooms.shared}`}
					aria-current={data.workspace === data.rooms.shared ? 'page' : undefined}>Shared room</a
				>
				<a
					data-sveltekit-reload
					href={resolve('/ops') + `?ws=${data.rooms.stage}`}
					aria-current={data.workspace === data.rooms.stage ? 'page' : undefined}>Stage</a
				>
				<a
					data-sveltekit-reload
					href={resolve('/ops') + `?ws=${data.synthWorkspace}`}
					aria-current={data.simulated ? 'page' : undefined}>Simulated run</a
				>
			</nav>
			<p class="roomline" title="Workspace and run this screen reads">
				{data.room.label}
				<span class="mono sys-only"
					>{data.workspace}{stream.state.runId || data.run
						? ` · ${stream.state.runId || data.run}`
						: ''}</span
				>
			</p>
			<!-- The room is said once, in the layout's "Where you are" line. -->
		</div>

		<dl class="figures">
			<div class:so={totals.signOff > 0}>
				<dt>
					{totals.decisions === 1 ? 'decision' : 'decisions'} for a person{totals.signOff
						? `, ${totals.signOff} sign-off`
						: ''}
				</dt>
				<dd>{totals.decisions}</dd>
			</div>
			<div class:bad={totals.cannot > 0}>
				<dt>{totals.cannot === 1 ? 'product' : 'products'} can't be ordered</dt>
				<dd>{totals.cannot}</dd>
			</div>
			<div class:bad={totals.unresolved > 0}>
				<dt>{totals.needs ? `of ${totals.needs} needs unresolved` : 'needs unresolved'}</dt>
				<dd>{totals.unresolved}</dd>
			</div>
			<div class="ok">
				<dt>ordered</dt>
				<dd>{euro(totals.committed)}</dd>
			</div>
			<div class:bad={totals.refused > 0}>
				<dt>refused by the rules</dt>
				<dd>{totals.refused}</dd>
			</div>
		</dl>

		<div class="status">
			<p class="pill" data-status={stream.status}>
				<i aria-hidden="true"></i>{STATUS[stream.status]}<span class="seq sys-only"
					>seq {stream.last}</span
				>
			</p>
			{#if scenarioNow}
				<p class="clock"><span>Scenario clock</span>{simTime(scenarioNow)}</p>
			{/if}

			{#if data.canReset}
				<form
					method="POST"
					action="?/resetRun"
					class="reset"
					use:enhance={({ cancel }) => {
						if (!confirmReset) {
							confirmReset = true;
							setTimeout(() => (confirmReset = false), 4000);
							return cancel();
						}
						confirmReset = false;
						return async ({ result, update }) => {
							if (result.type === 'success' && result.data?.reset)
								stream.resetTo(String(result.data.reset), Number(result.data.startedAt));
							await update({ reset: false });
						};
					}}
				>
					<button class:armed={confirmReset}
						>{confirmReset
							? data.workspace === data.rooms.stage
								? 'Click again to clear the stage'
								: 'Click again to clear this sandbox'
							: data.workspace === data.rooms.stage
								? 'Start a fresh run'
								: 'Start this sandbox over'}</button
					>
				</form>
			{/if}
			{#if form?.message}<p class="formmsg" role="status">{form.message}</p>{/if}
			{#if data.presenterSession}
				<form method="POST" action="?/signOut" use:enhance class="presenter">
					<button>Presenter: sign out</button>
				</form>
			{:else if !data.presenter && data.showPresenterSignIn}
				<details class="presenter">
					<summary>Presenter sign-in (stage operator only)</summary>
					<p class="keynote">
						For whoever runs the stage demo: their chef or approver key unlocks Run, Stop and Start
						over on the stage. Visitors don't need it.
					</p>
					<form method="POST" action="?/signIn" use:enhance>
						<label
							><span>Chef or approver key</span>
							<input name="key" type="password" autocomplete="off" required /></label
						>
						<button>Sign in</button>
					</form>
				</details>
			{/if}
			{#if data.judgeKeys}
				<details class="presenter" ontoggle={loadJudgeKey}>
					<summary>Agent key for this sandbox</summary>
					{#if judgeKey}
						<p class="keynote">
							An MCP client with this URL acts as an outside agent in your sandbox (it can propose,
							never approve):
						</p>
						<code class="mono">{judgeKey}</code>
					{:else}<p class="keynote">{judgeKeyNote}</p>{/if}
				</details>
			{/if}
		</div>
		<div class="services"><ServiceStatus /></div>
	</header>

	<TraceDrawer
		runs={stream.traces}
		bind:open={tracesOpen}
		bind:op={detailOp}
		canRun={data.canRunAgent}
	/>

	{#if data.simulated}
		<p class="banner">
			Simulated run. Real Valio products, invented quantities and prices, played on a loop to show
			how the room reads.
		</p>
	{/if}
	{#if stream.catchupError}
		<p class="banner warn">
			History could not be loaded ({stream.catchupError}). New events still arrive live.
		</p>
	{/if}

	{#if stream.status === 'live' && !stream.log.length && !inRoom}
		<section class="empty">
			<h2>No orders in this workspace yet</h2>
			<p>
				When a kitchen agent, a chef or an outside agent changes an order, it lands here as it
				happens, with who did it and why anything was held.
			</p>
			<a class="cta" data-sveltekit-reload href={resolve('/ops') + `?ws=${data.synthWorkspace}`}
				>Watch a simulated run</a
			>
		</section>
	{:else}
		<div class="views" role="tablist" aria-label="View">
			<button role="tab" aria-selected={view === 'room'} onclick={() => setView('room')}>
				Room <b>{kitchens.length}</b>
			</button>
			<button role="tab" aria-selected={view === 'problems'} onclick={() => setView('problems')}>
				Problems <b>{problems.filter((p) => p.tone !== 'quiet').length}</b>
			</button>
			<button role="tab" aria-selected={view === 'orders'} onclick={() => setView('orders')}>
				Orders <b>{Object.keys(stream.state.plans).length}</b>
			</button>
			<button role="tab" aria-selected={view === 'demand'} onclick={() => setView('demand')}>
				Demand
			</button>
			<button role="tab" aria-selected={view === 'forecast'} onclick={() => setView('forecast')}>
				Forecast
			</button>
			<button role="tab" aria-selected={view === 'flow'} onclick={() => setView('flow')}>
				Flow
			</button>
			<button role="tab" aria-selected={view === 'queue'} onclick={() => setView('queue')}>
				Queue <b>{cases.length}</b>
			</button>
			<button role="tab" aria-selected={view === 'wallboard'} onclick={() => setView('wallboard')}>
				Wallboard
			</button>
			{#if system}
				<button role="tab" aria-selected={view === 'engine'} onclick={() => setView('engine')}>
					Engine room
				</button>
			{:else}
				<p class="engine-hint">Turn on System for the engine room.</p>
			{/if}
		</div>
		<main class:split={view === 'problems' || view === 'engine'}>
			{#if view === 'room'}
				<RoomView
					{kitchens}
					totals={storeTotals(stream.state.orders)}
					feed={orderFeed(stream.state.orders, kitchenName)}
					shortage={lastIncident(stream.roomSims, INCIDENT_LABEL)
						? null
						: lastShortage(stream.roomSims)}
					{joinUrl}
					seedName={(id) => data.kitchens.find((k) => k.id === id)?.name ?? 'a seeded kitchen'}
					canShortage={!data.simulated && (data.presenter || data.room.kind === 'own')}
					presenter={data.presenter && data.workspace === data.rooms.shared}
					incident={lastIncident(stream.roomSims, INCIDENT_LABEL)}
				/>
			{:else if view === 'problems'}
				<section class="problems" aria-label="Problems, biggest first">
					{#each problems as p (p.id)}
						<ProblemCard
							{p}
							selected={selected?.id === p.id}
							due={cutoffIn(p.deadline)}
							href={problemHref(p)}
							onselect={() => (picked = p.id)}
						/>
					{:else}
						<p class="clear">
							Nothing waits on a person: no outage without an answer, no held line, no refused
							commit.
						</p>
					{/each}
				</section>
				<div class="story-col">
					{#if selected}
						<StoryPanel
							title={selected.title}
							steps={story.steps}
							hidden={story.hidden}
							time={clockTime}
							ondetail={showOp}
						/>
					{/if}
					<GatePanel g={gatePaths(stream.state)} />
				</div>
			{:else if view === 'orders'}
				<!-- A reset (here or in another tab) starts a new run with the seq cursor kept: remount to refetch. -->
				{#key stream.state.runId}
					<OrdersTab
						ws={data.workspace}
						{kitchens}
						version={stream.last}
						href={(planId, kitchenId) =>
							data.simulated ? null : kitchenHref({ planId, kitchenId }, linkAt)}
					/>
				{/key}
			{:else if view === 'forecast'}
				<ForecastTab
					ws={stream.state}
					kinds={kitchens.map((k) => k.kind)}
					from={scenarioDate(new Date(SCENARIO.start))}
					shortage={lastShortage(stream.roomSims)}
				/>
			{:else if view === 'flow'}
				<FlowTab ws={stream.state} {kitchenName} productName={(id) => productName(names, id)} />
			{:else if view === 'demand'}
				{#key stream.state.runId}
					<DemandTab ws={data.workspace} version={stream.last} />
				{/key}
			{:else if view === 'queue'}
				<Queue
					{cases}
					{kitchens}
					now={caseNow}
					relative={!data.simulated}
					at={data.simulated
						? undefined
						: { ws: data.workspace, run: stream.state.runId || data.run }}
				/>
			{:else if view === 'engine'}
				<div class="engine">
					<div class="engine-bar">
						<h2>Engine room</h2>
						<button class="traces" onclick={() => (tracesOpen = true)} aria-haspopup="dialog">
							Agent traces
							{#if stream.traces.length}<span class="count">{stream.traces.length}</span>{/if}
							{#if stream.traces[0] && !stream.traces[0].done}<i class="busy" aria-label="running"
								></i>{/if}
						</button>
					</div>
					<SponsorsPanel
						workspace={data.workspace}
						runId={stream.state.runId || data.run || ''}
						lines={Object.values(stream.state.plans).reduce((n, p) => n + p.lines.length, 0)}
					/>
					<OpTimeline log={stream.log} {names} plans={stream.state.plans} />
				</div>
			{:else}
				<section class="board" aria-label="Cases by kitchen">
					{#each columns as c (c.kitchen.id)}
						<div class="kitchen">
							<header>
								<h2>{c.kitchen.name}</h2>
								<p class="kmeta">
									{c.kitchen.city}, {c.kitchen.kind.replaceAll('_', ' ')}
									{#if c.external}<span class="outside">outside agent ordering</span>{/if}
								</p>
								<blockquote>“{c.kitchen.mandateWords}”</blockquote>
							</header>

							{#each c.anomalies as a (a.id)}
								<p class="anomaly">{a.message}</p>
							{/each}

							<div class="tickets">
								{#each c.cases as kc (kc.id)}
									<CaseTicket c={kc} fresh={freshPlan === kc.planId} />
								{:else}
									<p class="clear">
										{#if !c.plans.length}
											No order in progress.
										{:else if c.cover && c.cover.covered === c.cover.total}
											Covered: all {c.cover.total} needs have known supply.
										{:else if c.cover}
											Nothing held, but only {c.cover.covered} of {c.cover.total} needs have known supply;
											the rest is unresolved or rests on stock of unknown quantity.
										{:else}
											Nothing held. Coverage not reported yet.
										{/if}
									</p>
								{/each}
							</div>

							{#each c.orders as o (o.id)}
								<p class="order">
									<span>Ordered, {o.lines.length} lines</span>
									<span class="conf"
										>supplier confirmed {confirmedOf(o.id)} of {o.lines.length}</span
									>
									<b>{euro(o.totalCents)}</b>
								</p>
							{/each}

							<footer>
								{#if c.pending.length}
									<span class="waiting"
										>{c.pending.length} approval{c.pending.length === 1 ? '' : 's'} waiting</span
									>
								{/if}
								{#if c.committed}
									<span>Ordered <b>{euro(c.committed)}</b></span>
								{:else}
									<span>Nothing ordered yet</span>
								{/if}
							</footer>
						</div>
					{/each}
				</section>
			{/if}

			{#if view === 'engine'}
				<section class="log" aria-label="Op log" aria-live="polite">
					<h2>What just happened</h2>
					{#if stream.refused}
						<p class="stale sys-only" title={stream.lastRefused ?? ''}>
							{stream.refused} stale write{stream.refused === 1 ? '' : 's'} refused (another run)
						</p>
					{/if}
					<ol>
						{#each logAll ? stream.log : stream.log.slice(0, LOG_SHOWN) as e (e.seq)}
							{#if e.kind === 'sim'}
								<li class="sim" class:fresh={e.seq === stream.fresh}>
									<div class="when">
										<span class="seqn">{e.seq}</span>
										<span>{time(e.event.simAt)}</span>
									</div>
									<p><b>{SIM_KIND[e.event.kind]}.</b> {e.event.label}</p>
									<p class="who">
										<span class="simtag">simulated</span> Simulator, at simulated time
									</p>
								</li>
							{:else}
								{@const env = e.envelope}
								{@const pid = opPlanId(env)}
								<li
									class:fresh={e.seq === stream.fresh}
									class:rejected={!!e.rejected}
									data-actor={env.actor.kind}
								>
									<div class="when">
										<span class="seqn">{e.seq}</span>
										<span>{time(env.at)}</span>
									</div>
									<p>
										{#if pid}<b>{planKitchen(pid)}.</b>{/if}
										{opSummary(env, names, stream.state.plans)}
									</p>
									<p class="who">
										<span class="actor">{ACTOR[env.actor.kind]}</span>
										<span class="via" title={env.via}>{viaLabel(env.via)}</span>
										{#if data.simulated}<span class="simtag">simulated</span>{/if}
									</p>
									{#if e.rejected}<p class="rej">Rejected by the reducer: {e.rejected}</p>{/if}
								</li>
							{/if}
						{/each}
					</ol>
					{#if stream.log.length > LOG_SHOWN}
						<button class="more" onclick={() => (logAll = !logAll)}
							>{logAll ? 'Show the latest only' : `Show all ${stream.log.length}`}</button
						>
					{/if}
				</section>
			{/if}
		</main>
	{/if}
</div>

<style>
	.room {
		display: grid;
		grid-template-rows: auto auto auto 1fr;
		min-height: 100dvh;
		padding: 24px 32px 28px;
		gap: 18px;
	}

	/* Header: title + switch, the four figures that matter, connection state. */
	.room > header {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 40px;
		align-items: end;
		padding-bottom: 18px;
		border-bottom: 1px solid var(--line);
	}
	h1 {
		margin: 0;
		font-family: var(--cond);
		font-weight: 600;
		font-size: 44px;
		line-height: 1;
		letter-spacing: -0.01em;
	}
	nav {
		display: flex;
		gap: 4px;
		margin-top: 12px;
	}
	nav a {
		color: var(--muted);
		text-decoration: none;
		padding: 4px 12px;
		border-radius: 4px;
		font-size: 16px;
	}
	nav a[aria-current='page'] {
		background: var(--raise);
		color: var(--text);
	}
	nav a:hover {
		color: var(--text);
	}

	.figures {
		display: flex;
		flex-wrap: wrap;
		gap: 12px 28px;
		min-width: 0;
		margin: 0;
		justify-content: center;
	}
	.figures div {
		display: flex;
		flex-direction: column-reverse;
	}
	.figures dt {
		white-space: nowrap;
		color: var(--muted);
		font-size: 16px;
	}
	.figures dd {
		margin: 0;
		font-family: var(--cond);
		font-weight: 600;
		font-size: 48px;
		line-height: 1;
	}
	.figures .so dd {
		color: var(--sign-off);
	}
	.figures .ok dd {
		color: var(--done);
	}
	.figures .bad dd {
		color: var(--blocked);
	}

	.status {
		text-align: right;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		margin: 0;
		font-weight: 500;
	}
	.pill i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--faint);
	}
	.pill[data-status='live'] i {
		background: var(--done);
		box-shadow: 0 0 0 4px rgb(60 199 180 / 0.18);
	}
	.pill[data-status='reconnecting'] i,
	.pill[data-status='polling'] i {
		background: var(--sign-off);
	}
	.pill[data-status='offline'] i {
		background: var(--blocked);
	}
	.seq {
		font-family: var(--mono);
		color: var(--faint);
		font-size: 16px;
	}
	.clock {
		margin: 6px 0 0;
		font-family: var(--mono);
		font-size: 17px;
	}
	.clock span {
		font-family: var(--sans);
		color: var(--muted);
		margin-right: 10px;
		font-size: 15px;
	}

	.views {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: -6px;
	}
	.views button {
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		color: var(--muted);
		font: inherit;
		font-family: var(--cond);
		font-size: 20px;
		font-weight: 600;
		padding: 4px 12px 6px;
		cursor: pointer;
	}
	.views button[aria-selected='true'] {
		color: var(--text);
		border-bottom-color: var(--text);
	}
	.views b {
		font-family: var(--mono);
		font-weight: 500;
		font-size: 16px;
		color: var(--sign-off);
		margin-left: 4px;
	}
	.traces {
		margin-top: 10px;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 14px;
		border-radius: 6px;
		border: 1px solid var(--line);
		background: var(--raise);
		color: var(--text);
		font: inherit;
		font-size: 16px;
		cursor: pointer;
	}
	.traces:hover {
		border-color: var(--muted);
	}
	.reset {
		display: inline-block;
		margin: 10px 0 0 8px;
	}
	.reset button {
		padding: 6px 14px;
		border-radius: 6px;
		border: 1px solid var(--line);
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-size: 16px;
		cursor: pointer;
	}
	.reset button.armed {
		border-color: var(--sign-off);
		color: var(--sign-off);
	}
	.roomline {
		margin: 8px 0 0 12px;
		color: var(--muted);
		font-size: 15px;
	}
	.roomline .mono {
		display: block;
		white-space: nowrap;
		font-family: var(--mono);
		color: var(--faint);
		font-size: 13px;
	}
	.formmsg {
		margin: 8px 0 0;
		color: var(--sign-off);
		font-size: 15px;
	}
	.presenter {
		margin-top: 10px;
		font-size: 15px;
		color: var(--muted);
	}
	.presenter summary {
		cursor: pointer;
	}
	.presenter form {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		align-items: end;
		margin-top: 8px;
	}
	.presenter label {
		display: grid;
		gap: 4px;
		text-align: left;
	}
	.presenter input {
		background: var(--raise);
		color: var(--text);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 5px 8px;
		font: inherit;
	}
	.presenter button {
		padding: 6px 14px;
		border-radius: 6px;
		border: 1px solid var(--line);
		background: transparent;
		color: var(--muted);
		font: inherit;
		cursor: pointer;
	}
	.keynote {
		max-width: 340px;
		margin: 8px 0 4px auto;
		text-align: left;
	}
	.presenter code {
		display: block;
		max-width: 340px;
		margin-left: auto;
		word-break: break-all;
		text-align: left;
		color: var(--text);
		font-size: 13px;
	}
	.count {
		font-family: var(--mono);
		color: var(--propose);
	}
	.busy {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--done);
		animation: pulse 1s ease-in-out infinite alternate;
	}
	@keyframes pulse {
		to {
			opacity: 0.3;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.busy {
			animation: none;
		}
	}
	.banner {
		margin: 0;
		padding: 10px 16px;
		background: var(--hatch), var(--panel);
		border-left: 3px solid var(--outside);
		color: var(--muted);
		font-size: 16px;
	}
	.banner.warn {
		border-color: var(--sign-off);
	}

	main {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 24px;
		min-height: 0;
		align-items: start;
	}
	main.split {
		grid-template-columns: minmax(0, 1.6fr) minmax(360px, 1fr);
	}

	.services {
		grid-column: 1 / -1;
		margin-top: -22px;
	}

	/* Problems: the cards, then the selected one's story beside them. */
	.problems {
		display: grid;
		gap: 12px;
		align-content: start;
	}
	.story-col {
		position: sticky;
		top: 16px;
		max-height: calc(100dvh - 32px);
		overflow-y: auto;
		min-width: 0;
	}
	.engine {
		display: grid;
		gap: 12px;
		min-width: 0;
	}
	.engine-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.engine-bar h2 {
		margin: 0;
		font-family: var(--cond);
		font-size: 28px;
		font-weight: 600;
	}
	.engine-hint {
		margin: 0 0 0 auto;
		align-self: center;
		color: var(--faint);
		font-size: 14px;
	}

	/* Board: one column per kitchen, held lines as tickets. */
	.board {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 18px;
		align-items: start;
	}
	.kitchen {
		display: flex;
		flex-direction: column;
		gap: 12px;
		background: var(--panel);
		border-radius: 8px;
		padding: 18px;
		min-height: 100%;
	}
	.kitchen h2 {
		margin: 0;
		font-family: var(--cond);
		font-size: 26px;
		font-weight: 600;
		line-height: 1.1;
	}
	.kmeta {
		margin: 4px 0 0;
		color: var(--muted);
		font-size: 16px;
	}
	.outside {
		color: var(--outside);
		margin-left: 8px;
	}
	blockquote {
		margin: 10px 0 0;
		padding-left: 12px;
		border-left: 2px solid var(--line);
		color: var(--muted);
		font-size: 16px;
		line-height: 1.45;
	}
	.anomaly {
		margin: 0;
		padding: 10px 14px;
		border-radius: 6px;
		background: color-mix(in oklab, var(--blocked) 14%, var(--panel));
		color: var(--text);
		font-size: 17px;
	}
	.tickets {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.clear {
		margin: 6px 0;
		color: var(--muted);
		font-size: 17px;
	}
	.kitchen footer {
		margin-top: auto;
		padding-top: 12px;
		border-top: 1px solid var(--line);
		display: flex;
		justify-content: space-between;
		gap: 12px;
		color: var(--muted);
		font-size: 16px;
	}
	.kitchen footer b {
		color: var(--done);
		font-family: var(--mono);
		font-weight: 500;
	}
	.waiting {
		color: var(--sign-off);
	}
	.order {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0 12px;
		margin: 0;
		padding: 10px 14px;
		border-left: 4px solid var(--done);
		border-radius: 3px 6px 6px 3px;
		background: color-mix(in oklab, var(--done) 8%, var(--panel));
		font-size: 17px;
	}
	.order b {
		font-family: var(--mono);
		font-weight: 500;
		grid-row: span 2;
		align-self: center;
	}
	.order .conf {
		color: var(--muted);
		font-size: 15px;
	}

	/* Log: newest first, each row says what, who, through which door. */
	.log {
		background: var(--panel);
		border-radius: 8px;
		padding: 18px 0 0;
		display: flex;
		flex-direction: column;
		min-height: 0;
		align-self: start;
	}
	.log h2 {
		margin: 0 20px 10px;
		font-family: var(--cond);
		font-size: 22px;
		font-weight: 600;
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.log .more {
		margin: 8px 20px 14px;
		align-self: flex-start;
		background: transparent;
		border: 1px solid var(--line);
		color: var(--muted);
		border-radius: 999px;
		padding: 4px 14px;
		font: inherit;
		cursor: pointer;
	}
	li {
		display: grid;
		grid-template-columns: 74px 1fr;
		column-gap: 12px;
		padding: 12px 20px;
		border-top: 1px solid var(--line);
	}
	li > p {
		grid-column: 2;
		margin: 0;
		font-size: 17px;
	}
	.when {
		grid-row: span 3;
		display: flex;
		flex-direction: column;
		font-family: var(--mono);
		font-size: 14px;
		color: var(--faint);
	}
	.seqn {
		color: var(--muted);
		font-size: 16px;
	}
	.who {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		margin-top: 4px !important;
		font-size: 15px !important;
		color: var(--muted);
	}
	.actor {
		color: var(--text);
	}
	li[data-actor='external_agent'] .actor {
		color: var(--outside);
	}
	li[data-actor='approver'] .actor,
	li[data-actor='chef'] .actor {
		color: var(--done);
	}
	.via {
		font-family: var(--mono);
		color: var(--faint);
	}
	.simtag {
		padding: 0 8px;
		border-radius: 3px;
		background: var(--hatch), var(--raise);
		color: var(--outside);
		font-size: 14px;
	}
	li.sim {
		background: var(--hatch);
	}
	li.rejected p:first-of-type {
		text-decoration: line-through;
		color: var(--muted);
	}
	.rej {
		color: var(--blocked);
		font-size: 15px !important;
	}
	li.fresh {
		animation: arrive 1.2s ease-out;
	}
	@keyframes arrive {
		0% {
			background-color: rgb(90 169 255 / 0.22);
			transform: translateY(-8px);
			opacity: 0.4;
		}
		20% {
			transform: none;
			opacity: 1;
		}
		100% {
			background-color: transparent;
		}
	}

	.empty {
		max-width: 46ch;
		margin: 12vh auto 0;
		text-align: center;
	}
	.empty h2 {
		font-family: var(--cond);
		font-size: 32px;
		margin: 0 0 12px;
	}
	.empty p {
		color: var(--muted);
		margin: 0 0 24px;
	}
	.cta {
		display: inline-block;
		padding: 12px 22px;
		border-radius: 6px;
		background: var(--text);
		color: var(--bg);
		font-weight: 600;
		text-decoration: none;
	}

	@media (max-width: 1200px) {
		main,
		main.split {
			grid-template-columns: 1fr;
		}
		.story-col {
			position: static;
			max-height: none;
		}
		.log {
			max-height: none;
		}
		.room > header {
			grid-template-columns: 1fr auto;
		}
		.figures {
			grid-column: 1 / -1;
			grid-row: 2;
			justify-content: flex-start;
			flex-wrap: wrap;
			gap: 28px;
		}
	}
	@media (max-width: 760px) {
		.services {
			margin-top: 0;
		}
		.room {
			padding: 16px;
			min-width: 0;
		}
		/* One column: title and rooms, then the figures, then status and actions, all left-aligned. */
		.room > header {
			grid-template-columns: minmax(0, 1fr);
			gap: 16px;
		}
		.room > header > * {
			min-width: 0;
		}
		.figures {
			grid-row: auto;
			gap: 12px 24px;
		}
		.status {
			text-align: left;
		}
		nav {
			flex-wrap: wrap;
		}
		.roomline .mono {
			white-space: normal;
			overflow-wrap: anywhere;
		}
		.presenter form {
			justify-content: flex-start;
			flex-wrap: wrap;
		}
		.board {
			grid-template-columns: 1fr;
		}
		.figures dd {
			font-size: 36px;
		}
		h1 {
			font-size: 34px;
		}
	}
	/* Phone: the first screen reaches the problems. Figures two-up and smaller; the room name already shows in the
	   nav and the outside-service strip is depth, so both step aside. */
	@media (max-width: 480px) {
		.room > header {
			gap: 10px;
		}
		.figures {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 8px 16px;
		}
		.figures dd {
			font-size: 26px;
		}
		.figures dt {
			font-size: 13px;
		}
		.roomline,
		.services {
			display: none;
		}
		h1 {
			font-size: 28px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		li.fresh {
			animation: none;
		}
	}
	.stale {
		margin: 0 20px 8px;
		color: var(--faint);
		font-size: 15px;
	}
</style>
