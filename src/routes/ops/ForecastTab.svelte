<script lang="ts">
	import type { WorkspaceState } from '$lib/core/state';
	import {
		DEFAULT_PARAMS,
		ESTIMATES,
		forecast,
		stockInputs,
		type ProductForecast,
		type StockEvent,
		type Why
	} from '$lib/core/stock';
	import type { ShortageReplanned } from './room';
	import { readableName } from '$lib/ui/format';

	/**
	 * Valio's view, ahead (D27): where stock will run short in the next two weeks, per product the kitchens use.
	 * Modelled from Valio's own answer at quote time plus stated estimates (shown under "How this is modelled"), never
	 * a live stock reading. Labelled simulated.
	 */
	let {
		ws,
		kinds,
		from,
		shortage
	}: {
		ws: WorkspaceState;
		kinds: string[];
		/** First day (YYYY-MM-DD): the scenario's today. */
		from: string;
		shortage: ShortageReplanned | null;
	} = $props();

	const events = $derived<StockEvent[]>(
		shortage
			? [{ kind: 'shortage', productId: shortage.productId, day: from, left: shortage.left }]
			: []
	);
	const rows = $derived.by(() => {
		const { products, draws } = stockInputs(ws);
		return forecast(
			products,
			draws,
			kinds,
			{ ...DEFAULT_PARAMS, seed: ws.runId || 'demo', from },
			events
		);
	});
	const short = $derived(rows.filter((r) => r.shortOn));
	let showAll = $state(false);
	const shown = $derived(showAll ? rows : rows.slice(0, 12));

	const dayWords = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		});
	const WHY: Record<Why, string> = {
		valio: "Valio's answer",
		demand: 'everyday demand',
		festive: 'Christmas demand',
		orders: 'kitchen orders picked',
		restock: 'restocked',
		'short-ship': 'restock arrived short',
		shortage: 'shortage',
		scarce: 'restocked only to the week’s need'
	};
	/** The few reasons that moved this product most, in words. */
	function reasons(r: ProductForecast): string {
		const seen = new Set<Why>(r.days.flatMap((d) => d.why));
		const order: Why[] = ['shortage', 'short-ship', 'orders', 'scarce', 'festive'];
		const top = order.filter((w) => seen.has(w)).slice(0, 3);
		// A routine restock is only worth saying when nothing else moved the level.
		return (top.length ? top : seen.has('restock') ? (['restock'] as Why[]) : ['demand' as Why])
			.map((w) => WHY[w])
			.join(', ')
			.replace(/^./, (c) => c.toUpperCase());
	}

	const W = 140;
	const H = 32;
	/** Level as a line, need as dots, on one scale. */
	function spark(r: ProductForecast) {
		const max = Math.max(1, ...r.days.map((d) => Math.max(d.level, d.need)));
		const x = (i: number) => (i / Math.max(1, r.days.length - 1)) * W;
		const y = (v: number) => H - 2 - (v / max) * (H - 4);
		return {
			line: r.days
				.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.level).toFixed(1)}`)
				.join(''),
			needs: r.days
				.map((d, i) => ({ x: x(i), y: y(d.need), on: d.need > 0, short: d.need > d.level }))
				.filter((p) => p.on)
		};
	}
</script>

<section class="forecast" aria-label="Forecast">
	<p class="label">
		Simulated: modelled from Valio's answers and stated estimates, not live stock.
	</p>
	{#if !rows.length}
		<p class="lede">
			No forecast yet. It starts once a kitchen's plan has asked Valio about a product.
		</p>
	{:else}
		<p class="lede">
			{#if short.length}
				<b>{short.length}</b> of {rows.length} products the kitchens use may run short in the next two
				weeks. First: <b>{readableName(short[0].name)}</b> on {dayWords(short[0].shortOn!)}.
			{:else}
				None of the {rows.length} products the kitchens use runs short in the next two weeks.
			{/if}
		</p>
		<ul class="rows">
			{#each shown as r (r.productId)}
				{@const s = spark(r)}
				<li class:short={r.shortOn}>
					<span class="name">{readableName(r.name)}</span>
					<svg
						viewBox="0 0 {W} {H}"
						width={W}
						height={H}
						role="img"
						aria-label="Stock over two weeks, kitchen need as dots"
					>
						<path d={s.line} class="lvl" />
						{#each s.needs as p, i (i)}
							<circle cx={p.x} cy={p.y} r="2.5" class:over={p.short} />
						{/each}
					</svg>
					<span class="when">{r.shortOn ? `Short ${dayWords(r.shortOn)}` : 'Enough'}</span>
					<span class="why">{reasons(r)}</span>
				</li>
			{/each}
		</ul>
		{#if rows.length > shown.length}
			<button class="more" onclick={() => (showAll = true)}>Show all {rows.length} products</button>
		{/if}
	{/if}
	<details class="how">
		<summary>How this is modelled</summary>
		<ul>
			{#each Object.entries(ESTIMATES) as [k, e] (k)}
				<li><b>{e.source}.</b> {e.note}</li>
			{/each}
			<li>
				<b>Scarcity.</b> About {Math.round(DEFAULT_PARAMS.scarcityTarget * 100)}% of the products in
				play are restocked only to about the kitchens' need, so stock is something to plan around.
			</li>
		</ul>
	</details>
</section>

<style>
	.forecast {
		display: grid;
		gap: 12px;
	}
	.label {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--muted);
	}
	.lede {
		margin: 0;
		font-size: 1.125rem;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 140px 10rem;
		gap: 4px 16px;
		align-items: center;
		padding: 8px 0;
		border-bottom: 1px solid var(--line);
	}
	.name {
		font-weight: 600;
		min-width: 0;
	}
	.why {
		grid-column: 1 / -1;
		color: var(--muted);
		font-size: 0.875rem;
	}
	.when {
		text-align: right;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}
	.short .when {
		color: var(--blocked);
		font-weight: 600;
	}
	.lvl {
		fill: none;
		stroke: var(--text);
		stroke-width: 1.5;
	}
	circle {
		fill: var(--muted);
	}
	circle.over {
		fill: var(--blocked);
	}
	.more {
		justify-self: start;
		background: none;
		border: 0;
		padding: 4px 0;
		color: var(--muted);
		text-decoration: underline;
		cursor: pointer;
	}
	.how {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.how summary {
		cursor: pointer;
	}
	.how ul {
		margin: 8px 0 0;
		padding-left: 16px;
	}
	@media (max-width: 480px) {
		.rows li {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.rows svg {
			grid-column: 1 / -1;
			grid-row: 2;
			width: 100%;
		}
	}
</style>
