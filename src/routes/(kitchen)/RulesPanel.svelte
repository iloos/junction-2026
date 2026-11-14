<script lang="ts">
	import { Eye } from '@lucide/svelte';
	import { PRESETS, type PresetId, type PurchaseText, type Rules } from '$lib/kitchen/view-model';
	import ScoreLegend from '$lib/ui/ScoreLegend.svelte';
	import { money } from '$lib/ui/format';

	interface Preview {
		dish: string;
		recommended: PurchaseText[];
		saved: PurchaseText[];
	}
	interface Props {
		rules: Rules;
		preset: PresetId;
		contention: boolean;
		busy: boolean;
		/** Dishes where the previewed rules recommend something other than what the order holds. */
		previews: Preview[];
		onpreset: (p: PresetId) => void;
		oncontention: (on: boolean) => void;
		onapply: () => void;
	}
	let { rules, preset, contention, busy, previews, onpreset, oncontention, onapply }: Props =
		$props();
	const ids = Object.keys(PRESETS) as PresetId[];

	const originText = $derived(
		[
			...rules.originRequire.map((g) => `${g}: Finnish required`),
			...rules.originPrefer.map((g) => `${g}: Finnish preferred`)
		].join(' · ') || 'No origin rules'
	);
	const list = (xs: PurchaseText[]) =>
		xs.length ? xs.map((x) => `${x.name} · ${x.qtyText}`).join(', ') : 'nothing';
</script>

<section aria-labelledby="rules-h" class="rounded-lg border border-rule bg-sheet">
	<div class="flex items-baseline justify-between gap-2 px-4 pt-3.5">
		<h2 id="rules-h" class="text-body font-semibold text-ink">Same shortage. Your rules.</h2>
		<span class="mono text-micro text-ink-3">mandate v{rules.mandateVersion}</span>
	</div>
	<fieldset class="px-4 pt-2.5" disabled={busy}>
		<legend class="sr-only">Ranking rules</legend>
		<div class="grid grid-cols-3 rounded-md border border-rule-strong bg-well p-0.5">
			{#each ids as id (id)}
				<label
					class="relative grid h-9 cursor-pointer place-items-center rounded-[5px] px-1 text-center text-meta leading-tight font-medium transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent {preset ===
					id
						? 'bg-sheet text-ink shadow-[0_1px_2px_oklch(0.2_0.02_255/0.12)]'
						: 'text-ink-2 hover:text-ink'}"
				>
					<input
						type="radio"
						name="preset"
						value={id}
						checked={preset === id}
						class="sr-only"
						onchange={() => onpreset(id)}
					/>
					{PRESETS[id].label}
				</label>
			{/each}
		</div>
		<p class="mt-2 text-meta text-ink-2">{PRESETS[preset].hint}</p>
	</fieldset>

	{#if !previews.length && preset !== 'kitchen'}
		<p
			class="mx-4 mt-3 rounded-md bg-well px-3 py-2 text-meta leading-snug text-ink-2"
			role="status"
		>
			Your order already follows {PRESETS[preset].label.toLowerCase()}: these rules pick the same
			rescues.
		</p>
	{/if}
	{#if previews.length}
		<div
			class="mx-4 mt-3 rounded-md border border-propose/30 bg-propose-wash px-3 py-2.5"
			role="status"
		>
			<p class="flex items-start gap-2 text-meta leading-snug text-ink">
				<Eye size={15} class="mt-px shrink-0 text-propose" aria-hidden="true" />
				<span>
					<b class="font-medium">Previewing {PRESETS[preset].label.toLowerCase()}.</b> Your order is unchanged
					until you apply.
				</span>
			</p>
			<ul class="mt-2 space-y-1.5 text-meta leading-snug">
				{#each previews as p (p.dish)}
					<li>
						<span class="font-medium text-ink">{p.dish}:</span>
						<span class="text-ink-2">order has {list(p.saved)}</span>
						<span class="block text-propose">these rules pick {list(p.recommended)}</span>
					</li>
				{/each}
			</ul>
			<button
				type="button"
				class="mt-2.5 h-9 w-full rounded-md bg-propose px-3 text-body font-medium text-sheet hover:opacity-90 disabled:opacity-50"
				disabled={busy}
				onclick={onapply}>Apply these rules to the order</button
			>
			<p class="mt-1.5 text-micro leading-snug text-ink-3">
				Replaces the substitute, re-quotes, and voids the current approval: you review the new terms
				before anything is bought.
			</p>
		</div>
	{/if}

	<dl class="mt-3 space-y-2 border-t border-rule px-4 py-3 text-meta">
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
		<span class="text-meta leading-snug text-ink-2">
			<span class="font-medium text-ink">Simulator: another kitchen takes 4 palvikinkku</span>
			<span class="block"
				>15 in stock → 11, for every kitchen in this run. The ham rescue no longer covers 140
				guests.</span
			>
		</span>
	</label>
</section>
