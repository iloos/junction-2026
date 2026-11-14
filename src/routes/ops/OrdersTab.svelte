<script lang="ts">
	import { onMount } from 'svelte';
	import type { OrderRow } from './orders';
	import { euro } from './labels';

	/**
	 * Orders: one row per plan, and for the one opened its four stages as differences only: what was asked, what
	 * the agents changed and why, what was signed on which terms, what was ordered and what the supplier confirmed.
	 */
	let {
		ws,
		kitchens,
		version,
		href
	}: {
		ws: string;
		kitchens: { id: string; name: string }[];
		/** Changes whenever the op stream does: the list reloads (at most every RELOAD_MS). */
		version: number;
		/** The kitchen deep link for a plan, when there is one. */
		href: (planId: string, kitchenId: string) => string | null;
	} = $props();

	const RELOAD_MS = 1500;
	let orders = $state.raw<OrderRow[]>([]);
	let loaded = $state(false);
	let failed = $state<string | null>(null);
	let open = $state<string | null>(null);
	const selected = $derived(orders.find((o) => o.planId === open) ?? orders[0] ?? null);

	async function load() {
		try {
			const r = await fetch(`/ops/orders?ws=${encodeURIComponent(ws)}`, { cache: 'no-store' });
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			orders = ((await r.json()) as { orders: OrderRow[] }).orders;
			failed = null;
		} catch (e) {
			failed = e instanceof Error ? e.message : String(e);
		}
		loaded = true;
	}
	let timer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		void version;
		if (timer) return;
		timer = setTimeout(() => {
			timer = null;
			void load();
		}, RELOAD_MS);
	});
	onMount(() => {
		void load();
		return () => {
			if (timer) clearTimeout(timer);
		};
	});

	const kitchenName = (id: string) => kitchens.find((k) => k.id === id)?.name ?? id;
	const ORIGIN = {
		chat: 'Chat',
		request: 'Request',
		outside_agent: 'Outside agent',
		event: 'Event',
		kitchen: 'Kitchen'
	} as const;
	const CHIP = {
		valio: 'Valio data',
		chef: 'Chef',
		approver: 'Approver',
		kitchen_agent: 'Kitchen agent',
		external_agent: 'Outside agent',
		system: 'System',
		job: 'Monitor job'
	} as const;
	const STATUS = {
		confirmed: 'confirmed',
		awaiting: 'awaiting the supplier',
		ordered: 'ordered'
	} as const;
	const time = (iso: string) =>
		iso
			? new Date(iso).toLocaleString('en-GB', {
					weekday: 'short',
					hour: '2-digit',
					minute: '2-digit',
					timeZone: 'Europe/Helsinki'
				})
			: '';
</script>

<section class="orders" aria-label="Orders">
	{#if !loaded}
		<p class="note">Loading orders…</p>
	{:else if failed && !orders.length}
		<p class="note">Orders could not be loaded ({failed}).</p>
	{:else if !orders.length}
		<p class="note">No orders in this run yet.</p>
	{:else}
		<ol class="list" aria-label="Orders, newest first">
			{#each orders as o (o.planId)}
				<li>
					<button
						class="row"
						class:sel={selected?.planId === o.planId}
						aria-current={selected?.planId === o.planId ? 'true' : undefined}
						onclick={() => (open = o.planId)}
					>
						<span class="t">{o.title}</span>
						<span class="origin" data-origin={o.origin}>{ORIGIN[o.origin]}</span>
						<span class="k">{kitchenName(o.kitchenId)} · delivery {o.deliverBy}</span>
						<span class="s" class:done={o.done}>{o.status}</span>
						<span class="m">
							{#if o.orderedCents}<b>{euro(o.orderedCents)}</b> ordered{/if}
							{#if o.orderedCents && o.waitingCents}
								·
							{/if}
							{#if o.waitingCents}<b>{euro(o.waitingCents)}</b> waiting{/if}
						</span>
					</button>
				</li>
			{/each}
		</ol>

		{#if selected}
			{@const o = selected}
			{@const link = href(o.planId, o.kitchenId)}
			<article class="detail" aria-label="Stages of {o.title}">
				<header>
					<h2>{o.title}</h2>
					<p class="sub">
						{kitchenName(o.kitchenId)} · delivery {o.deliverBy}
						<span class="sys-only mono">{o.planId} · v{o.version}</span>
					</p>
				</header>

				<section class="stage">
					<h3><i>1</i>Asked</h3>
					<p class="lede">By {o.asked.actor}, {time(o.asked.at)}.</p>
					<ul class="needs">
						{#each o.asked.needs as n (n.id)}
							<li>
								<span
									>{n.label}{#if n.later}<em> (added later)</em>{/if}</span
								>
								<b>{n.amount}</b>
								<small>{n.basis}</small>
							</li>
						{/each}
					</ul>
				</section>

				<section class="stage">
					<h3><i>2</i>Proposed</h3>
					{#if o.proposed.changes.length}
						<ol class="changes">
							{#each o.proposed.changes as c (c.seq + c.text)}
								<li>
									<span class="tm">{time(c.at)}</span>
									<span class="chip">{CHIP[c.actor]}</span>
									<p>{c.text}</p>
								</li>
							{/each}
						</ol>
					{:else}
						<p class="lede">No changes from what was asked.</p>
					{/if}
					{#if o.proposed.unchanged}
						<p class="same">
							{o.proposed.unchanged}
							{o.proposed.unchanged === 1 ? 'line' : 'lines'} as first planned, not listed.
						</p>
					{/if}
				</section>

				<section class="stage">
					<h3><i>3</i>Signed</h3>
					{#if o.signed.length}
						<ol class="changes">
							{#each o.signed as a (a.seq)}
								<li data-state={a.state}>
									<span class="tm">{time(a.at)}</span>
									<p>{a.text} <span class="sys-only mono">{a.terms}</span></p>
								</li>
							{/each}
						</ol>
					{:else}
						<p class="lede">Nothing needed signing.</p>
					{/if}
					{#if o.decisions.length}
						<ul class="decisions">
							{#each o.decisions as d (d.key)}
								<li class:so={d.signOff}>
									<b>{d.reason}</b>
									<span>{d.lines} line{d.lines === 1 ? '' : 's'} · {euro(d.totalCents)}</span>
									<small>{d.consequence}</small>
								</li>
							{/each}
						</ul>
						{#if link}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- kitchen deep link with query -->
							<a class="go" href={link}>Decide in the kitchen</a>
						{/if}
					{/if}
				</section>

				<section class="stage">
					<h3><i>4</i>Ordered</h3>
					{#if o.ordered.length}
						{#each o.ordered as ord (ord.orderId)}
							<p class="lede">
								{time(ord.at)} · {euro(ord.totalCents)}
								<span class="sys-only mono">{ord.terms}</span>
							</p>
							<ul class="lines">
								{#each ord.lines as l, i (i)}
									<li data-status={l.status}>
										<span>{l.name}</span>
										<span>{l.qty}</span>
										<span>{euro(l.cents)}</span>
										<em>{STATUS[l.status]}</em>
									</li>
								{/each}
							</ul>
						{/each}
					{:else}
						<p class="lede">Not ordered yet.</p>
					{/if}
				</section>
			</article>
		{/if}
	{/if}
</section>

<style>
	.orders {
		display: grid;
		grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.6fr);
		gap: 20px;
		align-items: start;
		min-width: 0;
	}
	.note {
		color: var(--muted);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 2px 10px;
		width: 100%;
		text-align: left;
		padding: 12px 14px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 8px;
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.row.sel {
		border-color: var(--propose);
		box-shadow: inset 3px 0 0 var(--propose);
	}
	.t {
		font-weight: 600;
		font-size: 17px;
	}
	.origin {
		align-self: start;
		padding: 0 8px;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 13px;
		color: var(--muted);
	}
	.origin[data-origin='outside_agent'] {
		color: var(--outside);
	}
	.k,
	.s,
	.m {
		grid-column: 1 / -1;
		font-size: 14px;
		color: var(--muted);
	}
	.s {
		color: var(--sign-off);
	}
	.s.done {
		color: var(--done);
	}
	.m b {
		font-family: var(--mono);
		font-weight: 500;
		color: var(--text);
	}
	.detail {
		background: var(--panel);
		border-radius: 8px;
		padding: 18px 20px;
		min-width: 0;
	}
	h2 {
		margin: 0;
		font-family: var(--cond);
		font-size: 26px;
		font-weight: 600;
	}
	.sub {
		margin: 2px 0 6px;
		color: var(--muted);
		font-size: 15px;
	}
	.mono {
		font-family: var(--mono);
		font-size: 12.5px;
		color: var(--faint);
	}
	.stage {
		border-top: 1px solid var(--line);
		padding: 12px 0 6px;
	}
	h3 {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0 0 6px;
		font-size: 18px;
	}
	h3 i {
		display: inline-grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--raise);
		font-style: normal;
		font-size: 13px;
		color: var(--muted);
	}
	.lede,
	.same {
		margin: 0 0 6px;
		color: var(--muted);
		font-size: 15px;
	}
	.needs,
	.lines,
	.decisions,
	.changes {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	.needs li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0 12px;
		font-size: 15px;
	}
	.needs small {
		grid-column: 1 / -1;
		color: var(--faint);
		font-size: 13px;
	}
	.needs b,
	.lines span:nth-child(3) {
		font-family: var(--mono);
		font-weight: 500;
	}
	.changes li {
		display: grid;
		grid-template-columns: 92px auto minmax(0, 1fr);
		gap: 0 10px;
		align-items: baseline;
		font-size: 15px;
	}
	.changes li[data-state] {
		grid-template-columns: 92px minmax(0, 1fr);
	}
	.changes p {
		margin: 0;
	}
	.tm {
		font-family: var(--mono);
		font-size: 12.5px;
		color: var(--faint);
	}
	.chip {
		padding: 0 8px;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 12.5px;
		color: var(--muted);
		white-space: nowrap;
	}
	[data-state='pending'] p {
		color: var(--sign-off);
	}
	[data-state='granted'] p {
		color: var(--done);
	}
	[data-state='denied'] p {
		color: var(--blocked);
	}
	.decisions {
		margin-top: 8px;
	}
	.decisions li {
		display: grid;
		gap: 0 12px;
		grid-template-columns: minmax(0, 1fr) auto;
		padding: 8px 10px;
		border-left: 3px solid var(--propose);
		background: var(--raise);
		border-radius: 0 6px 6px 0;
		font-size: 15px;
	}
	.decisions li.so {
		border-left-color: var(--sign-off);
	}
	.decisions small {
		grid-column: 1 / -1;
		color: var(--muted);
	}
	.go {
		display: inline-block;
		margin-top: 8px;
		padding: 5px 12px;
		border: 1px solid var(--line);
		border-radius: 6px;
		color: var(--text);
		text-decoration: none;
	}
	.lines li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto auto;
		gap: 0 12px;
		font-size: 15px;
	}
	.lines em {
		font-style: normal;
		color: var(--muted);
		font-size: 13px;
	}
	.lines [data-status='confirmed'] em {
		color: var(--done);
	}
	.lines [data-status='awaiting'] em {
		color: var(--sign-off);
	}
	@media (max-width: 900px) {
		.orders {
			grid-template-columns: 1fr;
		}
		.changes li {
			grid-template-columns: auto minmax(0, 1fr);
		}
		.changes li .tm {
			grid-column: 1 / -1;
		}
		.lines li {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.lines em {
			grid-column: 1 / -1;
		}
	}
</style>
