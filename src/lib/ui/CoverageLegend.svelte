<script lang="ts">
	/** Key for CoverageBar: each certainty level once, in the order the bar fills. */
	import { BUCKETS, EXCESS } from './coverage';
</script>

<ul class="legend" aria-label="How to read the coverage bars">
	<li><span class="mark" aria-hidden="true"></span>Needed</li>
	{#each BUCKETS as b (b.key)}
		<li title={b.hint}><span class="sw {b.key}" aria-hidden="true"></span>{b.label}</li>
	{/each}
	<li title={EXCESS.hint}><span class="sw excess" aria-hidden="true"></span>{EXCESS.label}</li>
</ul>

<style>
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 11.5px;
		color: var(--color-ink-2);
	}
	li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.sw {
		width: 16px;
		height: 8px;
		border-radius: 2px;
	}
	.mark {
		width: 2px;
		height: 12px;
		background: var(--color-ink);
	}
	.supplierConfirmed {
		background: var(--color-ok);
	}
	.awaitingSupplier {
		background: repeating-linear-gradient(
			-45deg,
			var(--color-ok) 0 3px,
			color-mix(in oklch, var(--color-ok) 35%, var(--color-sheet)) 3px 6px
		);
	}
	.plannedKnown {
		background: var(--color-accent);
	}
	.plannedUnknown {
		background: repeating-linear-gradient(
			-45deg,
			var(--color-signoff) 0 3px,
			var(--color-signoff-wash) 3px 6px
		);
	}
	.unresolved {
		background: var(--color-out-wash);
		box-shadow: inset 0 0 0 1px var(--color-out);
	}
	.excess {
		background: repeating-linear-gradient(
			90deg,
			var(--color-rule-strong) 0 1px,
			transparent 1px 4px
		);
		box-shadow: inset 0 0 0 1px var(--color-rule);
	}
</style>
