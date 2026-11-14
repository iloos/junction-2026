<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { scenarioClock } from '$lib/core/scenario';
	import { OpsStream } from './stream.svelte';
	import Ticket from './Ticket.svelte';
	import TraceDrawer from './TraceDrawer.svelte';
	import Queue from './Queue.svelte';
	import { buildCases, coverage } from './cases';
	import { ACTOR, euro, lineIsHeld, opPlanId, opSummary, SIM_KIND } from './labels';

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
	let anchor = $state(data.runStartedAt);
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

	const kitchenName = (id: string) => data.kitchens.find((k) => k.id === id)?.name ?? id;
	const plans = $derived(Object.values(stream.state.plans));
	const planKitchen = (planId: string) => {
		const p = stream.state.plans[planId];
		return p ? kitchenName(p.kitchenId) : planId;
	};

	/** Queue (work surface) or wallboard (three-column board); remembered per browser. */
	let view = $state<'queue' | 'wallboard'>('queue');
	onMount(() => {
		try {
			if (localStorage.getItem('ops-view') === 'wallboard') view = 'wallboard';
		} catch {
			/* storage blocked: keep the default */
		}
	});
	const setView = (v: 'queue' | 'wallboard') => {
		view = v;
		try {
			localStorage.setItem('ops-view', v);
		} catch {
			/* not remembered */
		}
	};
	/** The queue rebuilds at most every QUEUE_MS, so bursts of ops don't re-render 200 rows per frame. */
	const QUEUE_MS = 250;
	let cases = $state.raw<ReturnType<typeof buildCases>>([]);
	let queueTimer: ReturnType<typeof setTimeout> | null = null;
	let queueDirty = false;
	$effect(() => {
		void stream.state;
		void stream.heldSince;
		queueDirty = true;
		if (queueTimer) return;
		const run = () => {
			queueTimer = null;
			if (!queueDirty) return;
			queueDirty = false;
			cases = buildCases(stream.state, data.names, stream.heldSince);
			queueTimer = setTimeout(run, QUEUE_MS);
		};
		run();
	});
	/** "Now" on the cases' clock: op times are scenario time live, wall time in the simulated run. */
	const caseNow = $derived(
		data.simulated ? new Date(wall).toISOString() : (scenarioNow ?? new Date(wall).toISOString())
	);

	const columns = $derived(
		data.kitchens.map((k) => {
			const mine = plans.filter((p) => p.kitchenId === k.id);
			const held = mine.flatMap((p) =>
				p.lines.filter(lineIsHeld).map((line) => ({ line, plan: p }))
			);
			const orders = Object.values(stream.state.orders).filter((o) => o.kitchenId === k.id);
			const committed = orders.reduce((s, o) => s + o.totalCents, 0);
			const anomalies = Object.values(stream.state.anomalies).filter((a) =>
				mine.some((p) => p.id === a.planId)
			);
			const pending = Object.values(stream.state.approvals).filter(
				(a) => a.state === 'pending' && mine.some((p) => p.id === a.planId)
			);
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
				cover: coverage(mine)
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
		// Same counts as the kitchen screen: "held" is lines waiting for a person; lines that cannot be ordered
		// at all (outages) are their own figure, and both are cases in the queue.
		const lines = columns.flatMap((c) => c.held).map((h) => h.line);
		const held = lines.filter((l) => l.state === 'held');
		return {
			held: held.length,
			unorderable: lines.filter((l) => l.state === 'unorderable').length,
			signOff: held.filter((l) => l.tier === 'sign_off').length,
			committed: Object.values(stream.state.orders).reduce((s, o) => s + o.totalCents, 0),
			refused: stream.state.failedCommits.length
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
					href={resolve('/ops') + '?ws=ws-judges'}
					aria-current={data.workspace === 'ws-judges' ? 'page' : undefined}>Shared room</a
				>
				<a
					data-sveltekit-reload
					href={resolve('/ops') + '?ws=ws-demo'}
					aria-current={data.workspace === 'ws-demo' ? 'page' : undefined}>Stage</a
				>
				<a
					data-sveltekit-reload
					href={resolve('/ops') + `?ws=${data.synthWorkspace}`}
					aria-current={data.simulated ? 'page' : undefined}>Simulated run</a
				>
			</nav>
			<p class="roomline" title="Workspace and run this screen reads">
				{data.room.label}
				<span class="mono">{data.workspace}{data.run ? ` · ${data.run}` : ''}</span>
			</p>
		</div>

		<dl class="figures">
			<div>
				<dt>held for a person</dt>
				<dd>{totals.held}</dd>
			</div>
			<div class:bad={totals.unorderable > 0}>
				<dt>can't be ordered</dt>
				<dd>{totals.unorderable}</dd>
			</div>
			<div class="so">
				<dt>need sign-off</dt>
				<dd>{totals.signOff}</dd>
			</div>
			<div class="ok">
				<dt>committed</dt>
				<dd>{euro(totals.committed)}</dd>
			</div>
			<div class:bad={totals.refused > 0}>
				<dt>commits refused</dt>
				<dd>{totals.refused}</dd>
			</div>
		</dl>

		<div class="status">
			<p class="pill" data-status={stream.status}>
				<i aria-hidden="true"></i>{STATUS[stream.status]}<span class="seq">seq {stream.last}</span>
			</p>
			{#if scenarioNow}
				<p class="clock"><span>Scenario clock</span>{simTime(scenarioNow)}</p>
			{/if}
			<button class="traces" onclick={() => (tracesOpen = true)} aria-haspopup="dialog">
				Agent traces
				{#if stream.traces.length}<span class="count">{stream.traces.length}</span>{/if}
				{#if stream.traces[0] && !stream.traces[0].done}<i class="busy" aria-label="running"
					></i>{/if}
			</button>
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
								stream.resetTo(String(result.data.reset));
							await update({ reset: false });
						};
					}}
				>
					<button class:armed={confirmReset}
						>{confirmReset
							? data.workspace === 'ws-demo'
								? 'Click again to clear the stage'
								: 'Click again to clear this sandbox'
							: data.workspace === 'ws-demo'
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
			{:else if !data.presenter}
				<details class="presenter">
					<summary>Presenter</summary>
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
	</header>

	<TraceDrawer runs={stream.traces} bind:open={tracesOpen} canRun={data.canRunAgent} />

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

	{#if stream.status === 'live' && !stream.log.length}
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
			<button role="tab" aria-selected={view === 'queue'} onclick={() => setView('queue')}>
				Queue <b>{cases.length}</b>
			</button>
			<button role="tab" aria-selected={view === 'wallboard'} onclick={() => setView('wallboard')}>
				Wallboard
			</button>
		</div>
		<main>
			{#if view === 'queue'}
				<Queue
					{cases}
					kitchens={data.kitchens}
					now={caseNow}
					relative={!data.simulated}
					at={data.simulated
						? undefined
						: { ws: data.workspace, run: stream.state.runId || data.run }}
				/>
			{:else}
				<section class="board" aria-label="Held lines by kitchen">
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
								{#each c.held as h (`${h.line.id}:${h.line.state}:${h.line.tier}`)}
									<Ticket line={h.line} names={data.names} fresh={freshPlan === h.plan.id} />
								{:else}
									<p class="clear">
										{#if !c.plans.length}
											No order in progress.
										{:else if c.cover && c.cover.covered === c.cover.total}
											Covered: all {c.cover.total}
											{c.cover.unit} are ordered or orderable within the mandate.
										{:else if c.cover}
											Nothing held, but only {c.cover.covered} of {c.cover.total}
											{c.cover.unit} are covered.
										{:else}
											Nothing held. Coverage not reported.
										{/if}
									</p>
								{/each}
							</div>

							{#each c.orders as o (o.id)}
								<p class="order">
									<span>Order committed, {o.lines.length} lines</span>
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
									<span>Committed <b>{euro(c.committed)}</b></span>
								{:else}
									<span>Nothing committed yet</span>
								{/if}
							</footer>
						</div>
					{/each}
				</section>
			{/if}

			<section class="log" aria-label="Op log" aria-live="polite">
				<h2>What just happened</h2>
				<ol>
					{#each stream.log as e (e.seq)}
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
									{opSummary(env, data.names)}
								</p>
								<p class="who">
									<span class="actor">{ACTOR[env.actor.kind]}</span>
									<span class="via">{env.via}</span>
									{#if data.simulated}<span class="simtag">simulated</span>{/if}
								</p>
								{#if e.rejected}<p class="rej">Rejected by the reducer: {e.rejected}</p>{/if}
							</li>
						{/if}
					{/each}
				</ol>
			</section>
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
		grid-template-columns: auto 1fr auto;
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
		gap: 28px;
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
		font-family: var(--mono);
		color: var(--faint);
		margin-left: 8px;
		font-size: 14px;
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
		grid-template-columns: minmax(0, 2.1fr) minmax(360px, 1fr);
		gap: 24px;
		min-height: 0;
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
		max-height: calc(100dvh - 210px);
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
		overflow-y: auto;
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
		main {
			grid-template-columns: 1fr;
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
		.room {
			padding: 16px;
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
	@media (prefers-reduced-motion: reduce) {
		li.fresh {
			animation: none;
		}
	}
</style>
