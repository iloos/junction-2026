<script lang="ts">
	import { encode } from 'uqr';
	import { enhance } from '$app/forms';
	import { INCIDENT_LABEL, INCIDENTS } from './incidents';
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { fade, fly } from 'svelte/transition';
	import {
		byActivity,
		firstOrders,
		isVisitorStore,
		kindCounts,
		kindWords,
		ordersLastMinute,
		OUTCOME_WORDS,
		STATE_WORDS,
		type StoreState,
		shortageSentence,
		type FeedOrder,
		type OpsKitchen,
		type ShortageReplanned
	} from './room';

	/**
	 * The room on the big screen (D24): a code to join as your own store, every store with what it has ordered, the
	 * orders as they land, and what the last shortage did to each store. Depth (lines, rules) lives in the other tabs.
	 */
	let {
		kitchens,
		totals,
		feed,
		shortage,
		joinUrl,
		seedName,
		canShortage,
		presenter = false,
		incident = null,
		states = {}
	}: {
		kitchens: OpsKitchen[];
		totals: Record<string, { n: number; cents: number }>;
		feed: FeedOrder[];
		shortage: ShortageReplanned | null;
		/** Null outside a room you can join (a sandbox shows no code). */
		joinUrl: string | null;
		seedName: (id: string) => string;
		canShortage: boolean;
		/** The presenter in the shared room: incidents and the room reset. */
		presenter?: boolean;
		/** The newest incident's re-plans, one per product (stream notices labelled "Simulated incident: …"). */
		incident?: { label: string; shortages: ShortageReplanned[] } | null;
		/** Each store's state for its tile's dot (room.ts storeStates). */
		states?: Record<string, StoreState>;
	} = $props();

	const story = $derived(
		incident ? INCIDENTS.find((i) => incident.label.endsWith(i.title)) : undefined
	);
	/** Seed names carry "(fictional)" for the data's sake; the room shows the store's name alone. */
	const plainName = (n: string) => n.replace(/\s*\(fictional\)$/, '');
	let deckBusy = $state<string | null>(null);
	let deckNote = $state<string | null>(null);
	let confirmReset = $state(false);

	/** Room scale (500+ stores): tiles by latest activity in a fixed panel; repetition only as counts. */
	const tiles = $derived(byActivity(kitchens, states, feed));
	const count = (s: StoreState) => kitchens.filter((k) => (states[k.id] ?? 'joined') === s).length;
	const nOrdered = $derived(count('ordered'));
	const nWaiting = $derived(count('waiting'));
	const nPlanning = $derived(count('planning'));
	const nIdle = $derived(kitchens.length - nOrdered - nWaiting - nPlanning);
	/** The feed shows the latest few; the rate says how busy the room is. */
	const FEED_SHOWN = 10;
	let now = $state(Date.now());
	onMount(() => {
		const t = setInterval(() => (now = Date.now()), 5000);
		return () => clearInterval(t);
	});
	const perMinute = $derived(ordersLastMinute(feed, now));
	const byKind = $derived(kindCounts(kitchens));
	const qr = $derived(joinUrl ? encode(joinUrl, { border: 2 }) : null);
	const euro = (c: number) =>
		(c / 100).toLocaleString('en-IE', { style: 'currency', currency: 'EUR' });
	const clock = (iso: string) =>
		new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
	const ordered = $derived(Object.values(totals).reduce((n, t) => n + t.cents, 0));
	const orderCount = $derived(Object.values(totals).reduce((n, t) => n + t.n, 0));
	/** The store whose order landed last, lit for a moment. */
	const lit = $derived(feed[0]?.kitchenId ?? null);

	/**
	 * Stores whose first order just landed: lit with "First order" for a few seconds, and named in one line over the
	 * room. Orders already there when the page opened (the catch-up) don't count.
	 */
	const FIRST_MS = 8000;
	let firsts = $state.raw<Record<string, number>>({});
	let lastFirst = $state<{ name: string; cents: number } | null>(null);
	let seen: Record<string, { n: number }> = {};
	let ready = false;
	onMount(() => {
		const t = setTimeout(() => (ready = true), 3000);
		return () => clearTimeout(t);
	});
	$effect(() => {
		const now = totals;
		const fresh = firstOrders(seen, now);
		seen = now;
		if (!ready || !fresh.length) return;
		const until = Date.now() + FIRST_MS;
		firsts = { ...firsts, ...Object.fromEntries(fresh.map((id) => [id, until])) };
		const k = kitchens.find((x) => x.id === fresh[0]);
		lastFirst = k ? { name: k.name, cents: now[fresh[0]].cents } : null;
		setTimeout(() => {
			const t = Date.now();
			firsts = Object.fromEntries(Object.entries(firsts).filter(([, u]) => u > t));
			if (!Object.keys(firsts).length) lastFirst = null;
		}, FIRST_MS + 50);
	});

	/** The join code full screen, for the projector: Escape or a click closes it. */
	let big = $state(false);
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') big = false;
	}

	let running = $state(false);
	let failed = $state<string | null>(null);
	async function runShortage() {
		running = true;
		failed = null;
		try {
			const r = await fetch('/kitchen-api/scenario', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'shortage' })
			});
			if (!r.ok) {
				const b = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
				failed = b?.error?.message ?? `The shortage could not run (${r.status}).`;
			}
		} catch {
			failed = 'The shortage could not run: no connection.';
		} finally {
			running = false;
		}
	}
</script>

<svelte:window onkeydown={onKey} />

{#snippet code()}
	{#if qr}
		<svg
			viewBox="0 0 {qr.size} {qr.size}"
			shape-rendering="crispEdges"
			role="img"
			aria-label="QR code to join this room"
		>
			{#each qr.data as row, y (y)}
				{#each row as on, x (x)}
					{#if on}<rect {x} {y} width="1" height="1" fill="#000" />{/if}
				{/each}
			{/each}
		</svg>
	{/if}
{/snippet}

{#if big && joinUrl}
	<div
		class="bigscreen"
		role="dialog"
		aria-modal="true"
		aria-label="Join code"
		transition:fade={{ duration: 150 }}
	>
		<button class="close" onclick={() => (big = false)}>Close</button>
		<div class="bigcode">{@render code()}</div>
		<p class="big-h">Join as your own store</p>
		<p class="big-url">{joinUrl.replace(/^https?:\/\//, '')}</p>
		<p class="big-sum">
			{kitchens.length} store{kitchens.length === 1 ? '' : 's'} in the room · {orderCount} order{orderCount ===
			1
				? ''
				: 's'} placed
		</p>
		{#if lastFirst}
			<p class="big-first" in:fly={{ y: 12 }}>
				{lastFirst.name} placed its first order: {euro(lastFirst.cents)}
			</p>
		{/if}
	</div>
{/if}

<section class="room" aria-label="The room">
	{#if lastFirst}
		<p class="first-line" role="status" in:fly={{ y: -8 }} out:fade>
			<b>{lastFirst.name}</b> placed its first order:
			<span class="num">{euro(lastFirst.cents)}</span>
		</p>
	{/if}
	<header class="head">
		<div class="sum">
			<h2>
				{kitchens.length} store{kitchens.length === 1 ? '' : 's'} in this room
			</h2>
			<p class="counts">
				<span><b class="num">{nOrdered}</b> ordered</span>
				<span><b class="num">{nWaiting}</b> waiting for a person</span>
				<span><b class="num">{nPlanning}</b> planning</span>
				<span
					><b class="num">{euro(ordered)}</b> in {orderCount} order{orderCount === 1
						? ''
						: 's'}</span
				>
				<span><b class="num">{perMinute}</b> in the last minute</span>
			</p>
			{#if byKind}<p class="kinds">{byKind}</p>{/if}
			<p>Every store orders under its own rules.</p>
		</div>
		{#if joinUrl && qr}
			<div class="join">
				{@render code()}
				<div>
					<p class="join-h">Join as your own store</p>
					<p class="join-t">Scan, name your store and pick its kind. Others in the room see it.</p>
					<button class="bigbtn" onclick={() => (big = true)}>Show the code full screen</button>
					<!-- An absolute link for another device (the QR's target), built from resolve('/') by the page. -->
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={joinUrl} class="join-link">{joinUrl.replace(/^https?:\/\//, '')}</a>
				</div>
			</div>
		{/if}
	</header>

	{#if presenter}
		<section class="deck" aria-label="Incidents">
			<h3>Run an incident</h3>
			<div class="deck-row">
				{#each INCIDENTS as inc (inc.id)}
					<form
						method="POST"
						action="?/incident"
						use:enhance={() => {
							deckBusy = inc.id;
							deckNote = null;
							return async ({ result, update }) => {
								deckBusy = null;
								if (result.type === 'failure')
									deckNote = String(result.data?.message ?? 'The incident could not run.');
								await update({ reset: false, invalidateAll: false });
							};
						}}
					>
						<input type="hidden" name="id" value={inc.id} />
						<button class="incident" disabled={!!deckBusy}>
							{deckBusy === inc.id ? 'Re-planning every store…' : inc.title}
						</button>
					</form>
				{/each}
			</div>
			{#if deckNote}<p class="note bad">{deckNote}</p>{/if}
			<div class="reset-row">
				{#if !confirmReset}
					<button class="linkish" onclick={() => (confirmReset = true)}>Reset the room…</button>
				{:else}
					<form
						method="POST"
						action="?/resetRoom"
						use:enhance={() => {
							return async ({ result, update }) => {
								confirmReset = false;
								if (result.type === 'failure')
									deckNote = String(result.data?.message ?? 'The room could not be reset.');
								else
									deckNote = `Room reset: ${String(result.type === 'success' ? (result.data?.removed ?? 0) : 0)} visitor stores removed, a fresh run started.`;
								await update({ reset: false });
							};
						}}
					>
						<input type="hidden" name="confirm" value="yes" />
						<span class="warn-text">Removes every visitor store, plan and order in this room.</span>
						<button class="danger">Reset the room</button>
						<button type="button" class="linkish" onclick={() => (confirmReset = false)}
							>Cancel</button
						>
					</form>
				{/if}
			</div>
		</section>
	{/if}

	{#if incident}
		<section class="incident-view" aria-label="Simulated incident">
			<p class="sim-label">{INCIDENT_LABEL}</p>
			<h3>{story?.title ?? incident.label.replace(`${INCIDENT_LABEL}: `, '')}</h3>
			{#if story}<p class="story">{story.story}</p>{/if}
			{#each incident.shortages as sh (sh.shortageId)}
				<p class="sentence">{shortageSentence(sh)}</p>
				<ul>
					{#each sh.kitchens.filter((k) => k.outcome !== 'unaffected') as k (k.kitchenId)}
						<li class="o-{k.outcome}">
							<span class="name">{plainName(k.kitchenName)}</span>
							<span class="chip">{OUTCOME_WORDS[k.outcome] ?? k.outcome}</span>
							<span class="why">
								{k.why}
								{#if k.swaps.length}
									<span class="swap"
										>{k.swaps.map((x) => `${x.fromName} → ${x.toName}`).join('; ')}</span
									>
								{/if}
								{#if k.allowedBy}<span class="rule">{k.allowedBy}</span>{/if}
							</span>
						</li>
					{:else}
						<li class="o-unaffected"><span class="why">No store's open plan uses it.</span></li>
					{/each}
				</ul>
			{/each}
		</section>
	{/if}

	<section class="shortage" aria-label="Shortage">
		<div class="sh-head">
			<h3>One shortage, every store</h3>
			{#if canShortage}
				<button class="primary" onclick={runShortage} disabled={running}>
					{running ? 'Re-planning every store…' : 'Run a shortage'}
				</button>
			{/if}
		</div>
		{#if failed}<p class="note bad">{failed}</p>{/if}
		{#if shortage}
			<p class="sentence">{shortageSentence(shortage)}</p>
			<ul>
				{#each shortage.kitchens as k (k.kitchenId)}
					<li class="o-{k.outcome}" in:fly={{ x: -12 }}>
						<span class="name">{plainName(k.kitchenName)}</span>
						<span class="chip">{OUTCOME_WORDS[k.outcome] ?? k.outcome}</span>
						<span class="why">
							{k.why}
							{#if k.swaps.length}
								<span class="swap"
									>{k.swaps.map((s) => `${s.fromName} → ${s.toName}`).join('; ')}</span
								>
							{/if}
							{#if k.allowedBy}<span class="rule">{k.allowedBy}</span>{/if}
						</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="note">
				When a product runs short, each store re-plans inside its own rules. The answer differs per
				store.
			</p>
		{/if}
	</section>

	<div class="cols">
		<section class="stores" aria-label="Stores">
			<h3>Stores</h3>
			<ul class="grid">
				{#each tiles as k (k.id)}
					{@const t = totals[k.id]}
					{@const st = states[k.id] ?? 'joined'}
					<li
						class="tile s-{st}"
						class:lit={lit === k.id}
						class:first={!!firsts[k.id]}
						title="{k.name}: {STATE_WORDS[st]}{k.copiedFrom
							? `, rules from ${seedName(k.copiedFrom)}`
							: ''}"
					>
						<span class="dot" aria-hidden="true"></span>
						<span class="name">{plainName(k.name)}</span>
						{#if t}<span class="value num">{euro(t.cents)}</span>{/if}
						{#if firsts[k.id]}<span class="firstbadge">First order</span
							>{:else if k.kind && k.kind !== 'blank' && (k.copiedFrom || !isVisitorStore(k))}<span
								class="kind">{kindWords(k.kind)}</span
							>{:else if st === 'waiting'}<span class="kind">Waits for a person</span>{/if}
						<span class="sr">{STATE_WORDS[st]}</span>
					</li>
				{/each}
			</ul>
			{#if nIdle}
				<p class="idle">
					{nIdle} store{nIdle === 1 ? " hasn't" : "s haven't"} started an order yet.
				</p>
			{/if}
		</section>

		<section class="feed" aria-label="Orders arriving" aria-live="polite">
			<h3>Orders arriving</h3>
			{#if feed.length}
				<p class="rate">
					<b class="num">{perMinute}</b> order{perMinute === 1 ? '' : 's'} in the last minute
				</p>
				<ol>
					{#each feed.slice(0, FEED_SHOWN) as o (o.id)}
						<li animate:flip={{ duration: 300 }} in:fly={{ y: -12, duration: 400 }}>
							<span class="when num">{clock(o.committedAt)}</span>
							<span class="name">{o.kitchenName}</span>
							<span class="value num">{euro(o.totalCents)}</span>
							<span class="meta">{o.lines} line{o.lines === 1 ? '' : 's'}</span>
						</li>
					{/each}
				</ol>
			{:else}
				<p class="note">No orders yet. They appear here the moment a store places one.</p>
			{/if}
		</section>
	</div>
</section>

<style>
	.room {
		display: grid;
		gap: 24px;
	}
	h2 {
		font-size: 1.5rem;
		margin: 0 0 4px;
	}
	h3 {
		font-size: 1.125rem;
		font-weight: 600;
		margin: 0 0 8px;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 16px;
		align-items: center;
	}
	.sum p {
		margin: 0;
		color: var(--muted);
	}
	.num {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.join {
		display: flex;
		gap: 16px;
		align-items: center;
		padding: 12px 16px;
		border: 1px solid var(--line);
		border-radius: 8px;
		max-width: 460px;
	}
	.join svg {
		width: 128px;
		height: 128px;
		flex-shrink: 0;
		background: #fff;
		border-radius: 4px;
	}
	.join p {
		margin: 0 0 4px;
	}
	.join-h {
		font-weight: 600;
	}
	.join-t {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.join-link {
		display: block;
		margin-top: 4px;
		font-size: 0.875rem;
		/* The host and the room as two readable pieces, never broken mid-word. */
		overflow-wrap: anywhere;
		word-break: normal;
	}
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
		gap: 24px;
	}
	ul,
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	/* Room scale: a dense grid of small tiles in a fixed panel that scrolls inside, so the page never grows. */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		gap: 6px;
		max-height: min(60vh, 560px);
		overflow-y: auto;
		align-content: start;
	}
	.stores li {
		/* Holds the visually hidden state word, so it never reaches past the scrolling panel. */
		position: relative;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 2px 6px;
		padding: 6px 8px;
		border: 1px solid var(--line);
		border-radius: 6px;
		font-size: 0.875rem;
		transition: background 0.6s;
	}
	/* Names wrap to two lines rather than being cut ("no truncated chips"). */
	.tile .name {
		overflow-wrap: anywhere;
		line-height: 1.25;
	}
	.tile .kind,
	.tile .firstbadge {
		grid-column: 2 / -1;
		margin: 0;
		font-size: 0.75rem;
		color: var(--muted);
	}
	.tile .firstbadge {
		justify-self: start;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--line);
	}
	.s-planning .dot {
		background: var(--muted);
	}
	.s-waiting .dot {
		background: #d4a017;
	}
	.s-ordered .dot {
		background: var(--done);
	}
	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 16px;
	}
	.idle,
	.rate {
		margin: 8px 0 0;
		color: var(--muted);
		font-size: 0.875rem;
	}
	.rate {
		margin: 0 0 8px;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	.stores li.lit {
		background: color-mix(in srgb, var(--done) 18%, transparent);
	}
	.name {
		font-weight: 600;
	}
	.value {
		text-align: right;
	}
	.meta {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.count {
		color: var(--muted);
		font-size: 0.875rem;
		text-align: right;
	}
	.new {
		margin-left: 8px;
		color: var(--done);
	}
	.feed li {
		display: grid;
		grid-template-columns: 3.5rem minmax(0, 1fr) auto;
		gap: 2px 12px;
		padding: 8px 0;
		border-bottom: 1px solid var(--line);
	}
	.feed .meta {
		grid-column: 2 / -1;
	}
	.when {
		color: var(--muted);
	}
	.sh-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}
	.primary {
		padding: 8px 16px;
		border-radius: 6px;
		border: 0;
		background: var(--text);
		color: var(--bg, #000);
		font-weight: 600;
		cursor: pointer;
	}
	.primary:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.sentence {
		font-size: 1.125rem;
		margin: 8px 0 12px;
	}
	.shortage li {
		display: grid;
		grid-template-columns: minmax(8rem, 14rem) 11rem minmax(0, 1fr);
		gap: 4px 12px;
		padding: 8px 0;
		border-bottom: 1px solid var(--line);
		align-items: baseline;
	}
	.chip {
		justify-self: start;
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 0.8125rem;
		white-space: nowrap;
		border: 1px solid var(--faint);
	}
	.o-swapped .chip,
	.o-kept .chip {
		border-color: var(--done);
		color: var(--done);
	}
	.o-held .chip {
		border-color: var(--sign-off);
		color: var(--sign-off);
	}
	.o-short .chip {
		border-color: var(--blocked);
		color: var(--blocked);
	}
	.o-unaffected {
		color: var(--muted);
	}
	.why {
		display: grid;
		gap: 2px;
	}
	.swap,
	.rule {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.more {
		margin-top: 8px;
		background: none;
		border: 0;
		padding: 4px 0;
		color: var(--muted);
		cursor: pointer;
		text-decoration: underline;
	}
	.note {
		color: var(--muted);
		margin: 0;
	}
	.deck {
		display: grid;
		gap: 8px;
		padding: 12px 16px;
		border: 1px dashed var(--line);
		border-radius: 8px;
	}
	.deck-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.incident {
		padding: 8px 14px;
		border-radius: 6px;
		border: 1px solid var(--sign-off);
		background: none;
		color: var(--text);
		cursor: pointer;
	}
	.incident:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.reset-row form {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.warn-text {
		color: var(--blocked);
		font-size: 0.875rem;
	}
	.danger {
		padding: 6px 12px;
		border-radius: 6px;
		border: 0;
		background: var(--blocked);
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}
	.linkish {
		background: none;
		border: 0;
		padding: 0;
		color: var(--muted);
		text-decoration: underline;
		cursor: pointer;
		font-size: 0.875rem;
	}
	.incident-view {
		display: grid;
		gap: 4px;
		padding: 12px 16px;
		border-left: 4px solid var(--sign-off);
		background: color-mix(in srgb, var(--sign-off) 8%, transparent);
		border-radius: 4px;
	}
	.incident-view h3 {
		margin: 0;
		font-size: 1.25rem;
	}
	.sim-label {
		margin: 0;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--sign-off);
	}
	.story {
		margin: 0 0 8px;
		font-size: 1.0625rem;
	}
	.incident-view ul {
		margin-bottom: 8px;
	}
	.incident-view li {
		display: grid;
		grid-template-columns: minmax(8rem, 14rem) 11rem minmax(0, 1fr);
		gap: 4px 12px;
		padding: 6px 0;
		border-bottom: 1px solid var(--line);
		align-items: baseline;
	}
	.bigbtn {
		margin-top: 6px;
		background: none;
		border: 0;
		padding: 0;
		color: var(--muted);
		text-decoration: underline;
		cursor: pointer;
		font-size: 0.875rem;
	}
	.first-line {
		margin: 0;
		padding: 10px 14px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--done) 20%, transparent);
		font-size: 1.125rem;
	}
	.stores li.first {
		background: color-mix(in srgb, var(--done) 28%, transparent);
		animation: pulse 1.2s ease-in-out 3;
	}
	.firstbadge {
		margin-left: 8px;
		padding: 1px 8px;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 600;
		background: var(--done);
		color: var(--bg, #000);
		vertical-align: middle;
	}
	@keyframes pulse {
		50% {
			background: color-mix(in srgb, var(--done) 45%, transparent);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.stores li.first {
			animation: none;
		}
	}
	.bigscreen {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 24px;
		background: var(--bg, #0b1724);
		text-align: center;
	}
	.bigcode svg {
		width: min(62vh, 80vw);
		height: min(62vh, 80vw);
		background: #fff;
		border-radius: 12px;
	}
	.big-h {
		margin: 8px 0 0;
		font-size: clamp(1.5rem, 4vw, 3rem);
		font-weight: 700;
	}
	.big-url {
		margin: 0;
		font-size: clamp(1rem, 2.4vw, 1.75rem);
		color: var(--muted);
		word-break: break-all;
	}
	.big-sum {
		margin: 0;
		font-size: clamp(1rem, 2vw, 1.5rem);
	}
	.big-first {
		margin: 0;
		font-size: clamp(1rem, 2vw, 1.5rem);
		color: var(--done);
		font-weight: 600;
	}
	.close {
		position: absolute;
		top: 16px;
		right: 16px;
		padding: 8px 14px;
		border-radius: 6px;
		border: 1px solid var(--line);
		background: none;
		color: var(--text);
		cursor: pointer;
	}
	.note.bad {
		color: var(--blocked);
	}
	@media (max-width: 720px) {
		.cols {
			grid-template-columns: minmax(0, 1fr);
		}
		.join svg {
			width: 96px;
			height: 96px;
		}
		.shortage li {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.why {
			grid-column: 1 / -1;
		}
	}
</style>
