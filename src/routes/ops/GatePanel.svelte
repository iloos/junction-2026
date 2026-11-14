<script lang="ts">
	import { share, type GatePaths } from './gate';

	/** How orders went through the rules in this run: counted from the log, nothing estimated. */
	let { g }: { g: GatePaths } = $props();

	const rows = $derived([
		{ key: 'straight', label: 'Ordered within the mandate, nobody asked', n: g.straight },
		{ key: 'signed', label: 'Ordered after a person signed', n: g.signed },
		{ key: 'waiting', label: 'Waiting on a person now', n: g.waiting }
	]);
</script>

<section class="gate" aria-label="How orders went through the rules">
	<h2>Through the rules, this run</h2>
	{#if g.lines || g.refused}
		<ul>
			{#each rows as r (r.key)}
				<li data-row={r.key}>
					<span class="label">{r.label}</span>
					<span class="bar" aria-hidden="true"><i style:width={share(r.n, g.lines)}></i></span>
					<span class="n">{r.n} {r.n === 1 ? 'line' : 'lines'} · {share(r.n, g.lines)}</span>
				</li>
			{/each}
			<li data-row="refused" class:none={g.refused === 0}>
				<span class="label">Refused by the rules</span>
				<span class="n">{g.refused} {g.refused === 1 ? 'attempt' : 'attempts'}</span>
			</li>
		</ul>
		<p class="note">
			Counted from this run's log. A retry that got its stored receipt back changes nothing, so it
			isn't counted.
		</p>
	{:else}
		<p class="note">Nothing ordered, held or refused in this run yet.</p>
	{/if}
</section>

<style>
	.gate {
		margin-top: 16px;
		background: var(--panel);
		border-radius: 8px;
		padding: 16px 20px;
	}
	h2 {
		margin: 0 0 10px;
		font-family: var(--cond);
		font-size: 20px;
		font-weight: 600;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	li {
		--tone: var(--muted);
		display: grid;
		grid-template-columns: minmax(0, 1fr) 90px auto;
		gap: 4px 12px;
		align-items: center;
		font-size: 15px;
	}
	li[data-row='straight'] {
		--tone: var(--done);
	}
	li[data-row='signed'] {
		--tone: var(--propose);
	}
	li[data-row='waiting'] {
		--tone: var(--sign-off);
	}
	li[data-row='refused'] {
		--tone: var(--blocked);
		grid-template-columns: minmax(0, 1fr) auto;
	}
	li[data-row='refused'] .n {
		color: var(--tone);
	}
	li.none .n {
		color: var(--muted);
	}
	.bar {
		height: 8px;
		border-radius: 3px;
		background: var(--raise);
		overflow: hidden;
	}
	.bar i {
		display: block;
		height: 100%;
		background: var(--tone);
	}
	.n {
		font-family: var(--mono);
		font-size: 13px;
		color: var(--muted);
		white-space: nowrap;
	}
	.note {
		margin: 10px 0 0;
		color: var(--faint);
		font-size: 13px;
	}
	@media (max-width: 760px) {
		li {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.bar {
			grid-column: 1 / -1;
			grid-row: 2;
		}
	}
</style>
