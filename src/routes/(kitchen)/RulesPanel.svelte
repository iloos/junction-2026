<script lang="ts">
	import { PRESETS, type PresetId, type Rules } from '$lib/kitchen/fixture-plan';
	import ScoreLegend from '$lib/ui/ScoreLegend.svelte';
	import { money } from '$lib/ui/format';

	interface Props {
		rules: Rules;
		preset: PresetId;
		contention: boolean;
		busy: boolean;
		onpreset: (p: PresetId) => void;
		oncontention: (on: boolean) => void;
	}
	let { rules, preset, contention, busy, onpreset, oncontention }: Props = $props();
	const ids = Object.keys(PRESETS) as PresetId[];

	const originText = $derived(
		[
			...rules.originRequire.map((g) => `${g}: Finnish required`),
			...rules.originPrefer.map((g) => `${g}: Finnish preferred`)
		].join(' · ') || 'No origin rules'
	);
</script>

<section aria-labelledby="rules-h" class="rounded-lg border border-rule bg-sheet">
	<div class="flex items-baseline justify-between gap-2 px-4 pt-3.5">
		<h2 id="rules-h" class="text-[14px] font-semibold text-ink">Same shortage. Your rules.</h2>
		<span class="mono text-[11.5px] text-ink-3">mandate v{rules.mandateVersion}</span>
	</div>
	<div class="px-4 pt-2.5">
		<div
			class="grid grid-cols-3 rounded-md border border-rule-strong bg-well p-0.5"
			role="radiogroup"
			aria-label="Ranking rules"
		>
			{#each ids as id (id)}
				<button
					type="button"
					role="radio"
					aria-checked={preset === id}
					disabled={busy}
					class="h-8 rounded-[5px] px-1 text-[12.5px] font-medium transition-colors duration-150 {preset ===
					id
						? 'bg-sheet text-ink shadow-[0_1px_2px_oklch(0.2_0.02_255/0.12)]'
						: 'text-ink-2 hover:text-ink'}"
					onclick={() => onpreset(id)}>{PRESETS[id].label}</button
				>
			{/each}
		</div>
		<p class="mt-2 text-[12.5px] text-ink-2">{PRESETS[preset].hint}</p>
	</div>
	<dl class="mt-3 space-y-2 border-t border-rule px-4 py-3 text-[12.5px]">
		<div>
			<dt class="text-ink-3">Ranking weights</dt>
			<dd class="mt-1"><ScoreLegend weights={rules.weights} /></dd>
		</div>
		<div class="flex justify-between gap-3">
			<dt class="text-ink-3">Origin</dt>
			<dd class="text-right text-ink">{originText}</dd>
		</div>
		<div class="flex justify-between gap-3">
			<dt class="text-ink-3">Acts alone up to</dt>
			<dd class="mono text-right text-ink">
				{money(rules.lineCapCents, { whole: true })} line · {money(rules.orderCapCents, {
					whole: true
				})} order · {money(rules.weeklyCapCents, { whole: true })} week
			</dd>
		</div>
		{#if rules.tenderList}
			<div class="flex justify-between gap-3">
				<dt class="text-ink-3">Tender list</dt>
				<dd class="text-right text-ink">{rules.tenderList.length} products only</dd>
			</div>
		{/if}
	</dl>
	<label class="flex cursor-pointer items-start gap-3 border-t border-dashed border-rule px-4 py-3">
		<input
			type="checkbox"
			class="mt-0.5 size-4 accent-[var(--color-accent)]"
			checked={contention}
			disabled={busy}
			onchange={(e) => oncontention(e.currentTarget.checked)}
		/>
		<span class="text-[12.5px] leading-snug text-ink-2">
			<span class="font-medium text-ink">Simulator: another kitchen takes 4 palvikinkku</span>
			<span class="block">15 in stock → 11. The ham rescue no longer covers 140 guests.</span>
		</span>
	</label>
</section>
