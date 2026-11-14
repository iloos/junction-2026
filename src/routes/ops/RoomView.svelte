<script lang="ts">
	import { encode } from 'uqr';
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { fade, fly } from 'svelte/transition';
	import {
		firstOrders,
		isVisitorStore,
		kindWords,
		OUTCOME_WORDS,
		roomOrder,
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
		canShortage
	}: {
		kitchens: OpsKitchen[];
		totals: Record<string, { n: number; cents: number }>;
		feed: FeedOrder[];
		shortage: ShortageReplanned | null;
		/** Null outside a room you can join (a sandbox shows no code). */
		joinUrl: string | null;
		seedName: (id: string) => string;
		canShortage: boolean;
	} = $props();

	/** Sample kitchens shown before the rest fold behind "+N sample kitchens". */
	const SAMPLES_SHOWN = 5;
	let allSamples = $state(false);
	const order = $derived(roomOrder(kitchens, totals));
	const shown = $derived([
		...order.active,
		...(allSamples ? order.samples : order.samples.slice(0, SAMPLES_SHOWN))
	]);
	const folded = $derived(allSamples ? 0 : Math.max(0, order.samples.length - SAMPLES_SHOWN));
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
			<p>
				{orderCount} order{orderCount === 1 ? '' : 's'} placed, <b class="num">{euro(ordered)}</b> in
				total. Every store orders under its own rules.
			</p>
		</div>
		{#if joinUrl && qr}
			<div class="join">
				{@render code()}
				<div>
					<p class="join-h">Join as your own store</p>
					<p class="join-t">Scan, name your store, pick its type. Others in the room see it.</p>
					<button class="bigbtn" onclick={() => (big = true)}>Show the code full screen</button>
					<!-- An absolute link for another device (the QR's target), built from resolve('/') by the page. -->
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={joinUrl} class="join-link">{joinUrl.replace(/^https?:\/\//, '')}</a>
				</div>
			</div>
		{/if}
	</header>

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
						<span class="name">{k.kitchenName}</span>
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
			<ul>
				{#each shown as k (k.id)}
					{@const t = totals[k.id]}
					<li
						class:lit={lit === k.id}
						class:first={!!firsts[k.id]}
						animate:flip={{ duration: 300 }}
						in:fly={{ y: 12 }}
					>
						<span class="name"
							>{k.name}{#if firsts[k.id]}<span class="firstbadge">First order</span>{/if}</span
						>
						<span class="value num">{t ? euro(t.cents) : ''}</span>
						<span class="meta">
							{kindWords(k.kind)}{k.city ? `, ${k.city}` : ''}
							{#if k.copiedFrom}<span class="new">new, rules from {seedName(k.copiedFrom)}</span
								>{:else if isVisitorStore(k)}<span class="new">new store</span>{/if}
						</span>
						<span class="count num"
							>{t ? `${t.n} order${t.n === 1 ? '' : 's'}` : 'Nothing ordered yet'}</span
						>
					</li>
				{/each}
			</ul>
			{#if folded}
				<button class="more" onclick={() => (allSamples = true)}>
					+{folded} sample kitchen{folded === 1 ? '' : 's'}
				</button>
			{/if}
		</section>

		<section class="feed" aria-label="Orders arriving" aria-live="polite">
			<h3>Orders arriving</h3>
			{#if feed.length}
				<ol>
					{#each feed as o (o.id)}
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
		font-size: 1rem;
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
		font-size: 0.875rem;
		word-break: break-all;
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
	.stores li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 2px 12px;
		/* Padded for the lit background, pulled back so names line up with the headings. */
		padding: 8px;
		margin-inline: -8px;
		border-bottom: 1px solid var(--line);
		border-radius: 4px;
		transition: background 0.6s;
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
