<script lang="ts">
	import { onMount } from 'svelte';
	import { amount, type DemandDay } from './demand';
	import { euro } from './labels';

	/**
	 * Demand, Valio's view: per delivery day, what every kitchen has ordered, signed and still proposes, product by
	 * product, the exceptions settled on the way and why quantities moved. Read-only.
	 */
	let { ws, version }: { ws: string; version: number } = $props();

	const RELOAD_MS = 2000;
	let days = $state.raw<DemandDay[]>([]);
	let loaded = $state(false);
	let failed = $state<string | null>(null);
	const SHOW = 12;
	let all = $state<Record<string, boolean>>({});

	async function load() {
		try {
			const r = await fetch(`/ops/demand?ws=${encodeURIComponent(ws)}`, { cache: 'no-store' });
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			days = ((await r.json()) as { days: DemandDay[] }).days;
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

	const pct = (part: number, total: number) => (total ? `${(part / total) * 100}%` : '0%');
	function split(p: DemandDay['products'][number]): string {
		const parts = [
			p.ordered ? `${amount(p.ordered, p.unit)} ordered` : '',
			p.signed ? `${amount(p.signed, p.unit)} signed` : '',
			p.proposed ? `${amount(p.proposed, p.unit)} proposed` : ''
		].filter(Boolean);
		return parts.join(' · ');
	}
</script>

<section class="demand" aria-label="Demand, Valio's view">
	<header class="intro">
		<h2>Demand, as Valio sees it</h2>
		<p class="legend">
			<span><i class="ordered"></i>ordered</span>
			<span><i class="signed"></i>signed, not yet ordered</span>
			<span><i class="proposed"></i>proposed</span>
		</p>
	</header>
	{#if !loaded}
		<p class="note">Loading demand…</p>
	{:else if failed && !days.length}
		<p class="note">Demand could not be loaded ({failed}).</p>
	{:else if !days.length}
		<p class="note">No orders in this run yet.</p>
	{/if}

	{#each days as d (d.date)}
		<article class="day" aria-label={d.day}>
			<h3>{d.sentence}</h3>
			<ul class="products">
				{#each all[d.date] ? d.products : d.products.slice(0, SHOW) as p (p.productId + p.unit)}
					{@const total = p.ordered + p.signed + p.proposed}
					<li>
						<span class="name">{p.name}</span>
						<span class="qty">{amount(total, p.unit)}</span>
						<span
							class="bar"
							role="img"
							aria-label={split(p)}
							title={`${split(p)} · ${p.kitchens} kitchen${p.kitchens === 1 ? '' : 's'}`}
						>
							<i class="ordered" style:width={pct(p.ordered, total)}></i>
							<i class="signed" style:width={pct(p.signed, total)}></i>
							<i class="proposed" style:width={pct(p.proposed, total)}></i>
						</span>
						<small>
							{split(p)}{p.kitchens > 1 ? ` · ${p.kitchens} kitchens` : ''} · {euro(p.cents)}
						</small>
					</li>
				{/each}
			</ul>
			{#if d.products.length > SHOW}
				<button class="more" onclick={() => (all = { ...all, [d.date]: !all[d.date] })}
					>{all[d.date]
						? 'Show the largest only'
						: `Show all ${d.products.length} products`}</button
				>
			{/if}

			{#if d.swaps.length || d.waived.length || d.reasons.length}
				<div class="exceptions">
					{#if d.swaps.length}
						<section>
							<h4>Swaps accepted</h4>
							<ul>
								{#each d.swaps as t, i (i)}<li>{t}</li>{/each}
							</ul>
						</section>
					{/if}
					{#if d.waived.length}
						<section>
							<h4>Ordered on unknown stock</h4>
							<ul>
								{#each d.waived as t, i (i)}<li>{t}</li>{/each}
							</ul>
						</section>
					{/if}
					{#if d.reasons.length}
						<section>
							<h4>Why quantities moved</h4>
							<ul>
								{#each d.reasons as t, i (i)}<li>{t}</li>{/each}
							</ul>
						</section>
					{/if}
				</div>
			{/if}
		</article>
	{/each}
</section>

<style>
	.demand {
		display: grid;
		gap: 16px;
		min-width: 0;
	}
	.intro {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 6px 20px;
	}
	h2 {
		margin: 0;
		font-family: var(--cond);
		font-size: 26px;
		font-weight: 600;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin: 0;
		color: var(--muted);
		font-size: 14px;
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.legend i {
		width: 12px;
		height: 8px;
		border-radius: 2px;
		display: inline-block;
	}
	.note {
		color: var(--muted);
	}
	.day {
		background: var(--panel);
		border-radius: 8px;
		padding: 16px 20px;
		min-width: 0;
	}
	h3 {
		margin: 0 0 10px;
		font-size: 19px;
		font-weight: 600;
	}
	.products {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	.products li {
		display: grid;
		grid-template-columns: minmax(0, 2fr) auto minmax(120px, 1.4fr);
		gap: 2px 14px;
		align-items: center;
		font-size: 15px;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.qty {
		font-family: var(--mono);
		text-align: right;
	}
	.bar {
		display: flex;
		height: 10px;
		border-radius: 3px;
		overflow: hidden;
		background: var(--raise);
	}
	.bar i {
		display: block;
		height: 100%;
	}
	.ordered {
		background: var(--done);
	}
	.signed {
		background: var(--propose);
	}
	.proposed {
		background: var(--sign-off);
	}
	small {
		grid-column: 1 / -1;
		color: var(--faint);
		font-size: 13px;
	}
	.more {
		margin-top: 8px;
		padding: 0;
		background: none;
		border: 0;
		color: var(--muted);
		font: inherit;
		font-size: 14px;
		text-decoration: underline;
		cursor: pointer;
	}
	.exceptions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 12px 20px;
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
	}
	h4 {
		margin: 0 0 4px;
		font-size: 15px;
	}
	.exceptions ul {
		margin: 0;
		padding-left: 18px;
		color: var(--muted);
		font-size: 14px;
		display: grid;
		gap: 2px;
	}
	@media (max-width: 760px) {
		.day {
			padding: 14px;
		}
		.products li {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.bar {
			grid-column: 1 / -1;
		}
	}
</style>
