<script lang="ts">
	/** Key for CoverageBar: each certainty level once, in the order the bar fills. */
	import { BUCKETS, EXCESS } from './coverage';
</script>

<ul class="legend" aria-label="How to read the coverage bars">
	<li><span class="mark" aria-hidden="true"></span>Needed</li>
	{#each BUCKETS as b (b.key)}
		<li title={b.hint}><span class="sw {b.cls}" aria-hidden="true"></span>{b.label}</li>
	{/each}
	<li title={EXCESS.hint}>
		<span class="sw {EXCESS.cls}" aria-hidden="true"></span>{EXCESS.label}
	</li>
</ul>

<style>
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: var(--text-micro);
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
</style>
