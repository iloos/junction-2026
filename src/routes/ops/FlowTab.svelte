<script lang="ts">
	import type { WorkspaceState } from '$lib/core/state';
	import { readableName } from '$lib/ui/format';
	import { flowLinks, layoutFlow } from './flow';

	/**
	 * Demand flow (Valio's view): where each store's money goes, by product. Solid bands are ordered, light ones
	 * planned but not ordered yet. Hover a band for its amount.
	 */
	let {
		ws,
		kitchenName,
		productName
	}: {
		ws: WorkspaceState;
		kitchenName: (id: string) => string;
		productName: (id: string) => string;
	} = $props();

	const H = 360;
	const W = 760;
	const NODE = 10;
	const links = $derived(flowLinks(ws));
	const f = $derived(
		layoutFlow(links, { kitchen: kitchenName, product: (id) => readableName(productName(id)) }, H)
	);
	const euro = (c: number) =>
		(c / 100).toLocaleString('en-IE', {
			style: 'currency',
			currency: 'EUR',
			maximumFractionDigits: 0
		});
	const ordered = $derived(links.filter((l) => l.ordered).reduce((n, l) => n + l.cents, 0));
	const stores = $derived(f.left.length);

	/** The band as a filled ribbon between the two node columns. */
	function ribbon(b: { y0: number; y1: number; t0: number; t1: number }) {
		const x0 = NODE;
		const x1 = W - NODE;
		const mx = (x0 + x1) / 2;
		return `M${x0},${b.y0}C${mx},${b.y0} ${mx},${b.t0} ${x1},${b.t0}L${x1},${b.t1}C${mx},${b.t1} ${mx},${b.y1} ${x0},${b.y1}Z`;
	}
</script>

<section class="flow" aria-label="Demand flow">
	{#if !f.total}
		<p class="lede">
			No demand yet. When a store plans or orders, its money shows flowing to products.
		</p>
	{:else}
		<p class="lede">
			{stores} store{stores === 1 ? '' : 's'} put <b class="num">{euro(f.total)}</b> on Valio Aimo
			products: <b class="num">{euro(ordered)}</b> ordered, the rest planned.
		</p>
		<div class="chart">
			<div class="col left">
				{#each f.left as n (n.id)}
					<span class="lab" style:top="{n.y + n.h / 2}px"
						>{n.label} <span class="num">{euro(n.cents)}</span></span
					>
				{/each}
			</div>
			<svg
				viewBox="0 0 {W} {H}"
				preserveAspectRatio="none"
				role="img"
				aria-label="Demand flow from stores to products"
			>
				{#each f.bands as b, i (i)}
					<path d={ribbon(b)} class:ordered={b.ordered}>
						<title
							>{kitchenName(b.from)} → {f.right.find((n) => n.id === b.to)?.label}: {euro(b.cents)}
							{b.ordered ? 'ordered' : 'planned'}</title
						>
					</path>
				{/each}
				{#each f.left as n (n.id)}
					<rect x="0" y={n.y} width={NODE} height={Math.max(1, n.h)} class="node" />
				{/each}
				{#each f.right as n (n.id)}
					<rect x={W - NODE} y={n.y} width={NODE} height={Math.max(1, n.h)} class="node" />
				{/each}
			</svg>
			<div class="col right">
				{#each f.right as n (n.id)}
					<span class="lab" style:top="{n.y + n.h / 2}px"
						>{n.label} <span class="num">{euro(n.cents)}</span></span
					>
				{/each}
			</div>
		</div>
		<p class="key">
			<span class="sw ordered"></span> ordered <span class="sw"></span> planned, not ordered yet
		</p>
	{/if}
</section>

<style>
	.flow {
		display: grid;
		gap: 12px;
	}
	.lede {
		margin: 0;
		font-size: 1.125rem;
	}
	.num {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.chart {
		display: grid;
		grid-template-columns: minmax(9rem, 14rem) minmax(0, 1fr) minmax(9rem, 16rem);
		gap: 12px;
		height: 360px;
	}
	svg {
		width: 100%;
		height: 360px;
	}
	.col {
		position: relative;
		height: 360px;
		font-size: 0.8125rem;
	}
	.lab {
		position: absolute;
		left: 0;
		right: 0;
		transform: translateY(-50%);
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.left .lab {
		text-align: right;
	}
	.lab .num {
		color: var(--muted);
	}
	path {
		fill: var(--muted);
		opacity: 0.18;
	}
	path.ordered {
		fill: var(--done);
		opacity: 0.45;
	}
	path:hover {
		opacity: 0.8;
	}
	.node {
		fill: var(--text);
	}
	.key {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--muted);
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.sw {
		display: inline-block;
		width: 12px;
		height: 12px;
		border-radius: 2px;
		background: var(--muted);
		opacity: 0.35;
	}
	.sw.ordered {
		background: var(--done);
		opacity: 0.7;
	}
	@media (max-width: 720px) {
		.chart {
			grid-template-columns: 6.5rem minmax(0, 1fr) 7.5rem;
			gap: 4px;
		}
		.col {
			font-size: 0.6875rem;
		}
		.lab .num {
			display: none;
		}
	}
</style>
