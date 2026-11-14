<script lang="ts" module>
	import type { PresetId } from '$lib/kitchen/view-model';
	/** The preset as the Product column says it: "Picked by: Reliability first". */
	export const PICKED_BY: Record<PresetId, string> = {
		kitchen: 'Reliability first',
		price: 'Price first',
		finnish: 'Finnish required',
		carbon: 'Lowest carbon',
		reliable: 'Most reliable'
	};
</script>

<script lang="ts">
	/**
	 * The kitchen's rules in two kinds. Hard rules the agent can't break (what it may spend alone, required origin,
	 * what always asks the chef) as locked rows; preferences (how it ranks what's left) as one choice of five with
	 * its weights in one stacked bar. The same-shortage preview compares and applies; it never offers to change a
	 * dish that is already ordered, and says so before the click.
	 */
	import { Eye, Lock } from '@lucide/svelte';
	import { PRESETS, type PurchaseText, type Rules } from '$lib/kitchen/view-model';
	import { money, moneyDelta, num, readableName, unitWord } from '$lib/ui/format';

	interface Preview {
		dish: string;
		recommended: PurchaseText[];
		saved: PurchaseText[];
		/** The dish is already ordered: these rules can't change it. */
		ordered?: boolean;
	}
	interface Props {
		rules: Rules;
		preset: PresetId;
		busy: boolean;
		/** Dishes where the previewed rules pick something other than what the order holds. */
		previews: Preview[];
		onpreset: (p: PresetId) => void;
		onapply: () => void;
	}
	let { rules, preset, busy, previews, onpreset, onapply }: Props = $props();
	const ids = Object.keys(PRESETS) as PresetId[];

	const ASKS: Record<string, string> = {
		allergen_change: 'an allergen change',
		new_sku: 'a product the kitchen has not bought before',
		substitute_breaks_preference: 'a substitute that breaks a preference',
		off_tender_list: 'anything off the tender list',
		origin_requirement: 'anything that breaks a required origin'
	};
	const asks = $derived(rules.neverDelegate.map((k) => ASKS[k] ?? k));

	const WEIGHT_ORDER = ['reliability', 'price', 'finnish', 'carbon', 'organic'] as const;
	const WEIGHT_LABEL: Record<string, string> = {
		reliability: 'Reliability',
		price: 'Price',
		finnish: 'Finnish',
		carbon: 'Carbon',
		organic: 'Organic'
	};
	const weights = $derived.by(() => {
		const w = rules.weights as Record<string, number | undefined>;
		const sum = WEIGHT_ORDER.reduce((s, k) => s + (w[k] ?? 0), 0) || 1;
		return WEIGHT_ORDER.filter((k) => (w[k] ?? 0) > 0).map((k) => ({
			k,
			label: WEIGHT_LABEL[k],
			pct: Math.round(((w[k] ?? 0) / sum) * 100)
		}));
	});

	const open = $derived(previews.filter((p) => !p.ordered));
	const locked = $derived(previews.filter((p) => p.ordered));
	/** Why Apply can't run, in words, before anyone clicks it. */
	const applyBlocked = $derived(
		!open.length && locked.length
			? `${locked.map((p) => p.dish).join(', ')} ${locked.length === 1 ? 'is' : 'are'} already ordered, so these rules can't change ${locked.length === 1 ? 'it' : 'them'}.`
			: null
	);

	const list = (xs: PurchaseText[]) =>
		xs.length
			? xs.map((x) => `${readableName(x.name)} · ${unitsInWords(x.qtyText)}`).join(', ')
			: 'nothing';
	/** "13 ST" → "13 pcs": the server's quantity text with Valio's unit codes in words. */
	const unitsInWords = (t: string) =>
		t.replace(
			/(\d[\d,.]*)\s+([A-Z]{1,3})\b/g,
			(_, n: string, u: string) => `${n} ${unitWord(u, Number(n.replace(',', '')))}`
		);
	/** What a swap changes, from the two picks' own numbers; nothing is said for a number either side lacks. */
	function delta(saved: PurchaseText[], picked: PurchaseText[]): string {
		const sum = (xs: PurchaseText[]) =>
			xs.every((x) => x.lineCents != null) ? xs.reduce((t, x) => t + (x.lineCents ?? 0), 0) : null;
		const co2 = (xs: PurchaseText[]) => (xs.length === 1 ? xs[0].co2PerKg : undefined);
		const bits: string[] = [];
		const a = co2(saved);
		const b = co2(picked);
		if (a !== undefined && b !== undefined && Math.abs(b - a) >= 0.05)
			bits.push(`${b < a ? '−' : '+'}${num(Math.abs(b - a), 1)} kg CO₂e/kg`);
		const ca = sum(saved);
		const cb = sum(picked);
		if (ca !== null && cb !== null && ca !== cb) bits.push(moneyDelta(cb - ca));
		return bits.join(', ');
	}
</script>

<section aria-labelledby="rules-h" class="rounded-lg border border-rule bg-sheet">
	<div class="flex items-baseline justify-between gap-2 px-4 pt-3.5">
		<h2 id="rules-h" class="text-body font-semibold text-ink">Your rules</h2>
		<span class="sys-only mono text-micro text-ink-3">mandate v{rules.mandateVersion}</span>
	</div>
	<div class="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:divide-x lg:divide-rule">
		<!-- Hard rules: what the agent can't do alone, whatever it prefers. -->
		<div class="px-4 py-3">
			<h3 class="text-meta font-medium text-ink-2">Hard rules · the agent can't break these</h3>
			<ul class="mt-2 space-y-1.5 text-meta text-ink">
				<li class="flex gap-2">
					<Lock size={13} class="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
					<span
						>Acts alone up to <span class="mono">{money(rules.lineCapCents, { whole: true })}</span>
						a line, <span class="mono">{money(rules.orderCapCents, { whole: true })}</span> an
						order,
						<span class="mono">{money(rules.weeklyCapCents, { whole: true })}</span> a week</span
					>
				</li>
				{#if rules.originRequire.length}
					<li class="flex gap-2">
						<Lock size={13} class="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
						<span>Finnish required: {rules.originRequire.join(', ')}</span>
					</li>
				{/if}
				{#if asks.length}
					<li class="flex gap-2">
						<Lock size={13} class="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
						<span>Always asks you first: {asks.join('; ')}</span>
					</li>
				{/if}
				{#if rules.tenderList}
					<li class="flex gap-2">
						<Lock size={13} class="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
						<span>Buys only from the tender list ({rules.tenderList.length} products)</span>
					</li>
				{/if}
			</ul>
		</div>

		<!-- Preferences: how it ranks what the hard rules allow. -->
		<div class="border-t border-rule px-4 py-3 lg:border-t-0">
			<h3 class="text-meta font-medium text-ink-2">
				Preferences · how it picks among what's allowed
			</h3>
			<fieldset class="mt-2" disabled={busy}>
				<legend class="sr-only">How the agent ranks substitutes</legend>
				<div class="flex flex-wrap gap-1.5">
					{#each ids as id (id)}
						<label
							class="cursor-pointer rounded-full border px-2.5 py-1 text-meta font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent {preset ===
							id
								? 'border-ink bg-ink text-sheet'
								: 'border-rule-strong text-ink-2 hover:text-ink'}"
						>
							<input
								type="radio"
								name="preset"
								value={id}
								checked={preset === id}
								class="sr-only"
								onchange={() => onpreset(id)}
							/>
							{PICKED_BY[id]}
						</label>
					{/each}
				</div>
			</fieldset>
			<p class="mt-1.5 text-meta text-ink-2">{PRESETS[preset].hint}</p>
			<!-- The weights as one bar: what each counts for when two products both pass the hard rules. -->
			<div
				class="mt-2 flex h-2 overflow-hidden rounded-full bg-well"
				role="img"
				aria-label="Ranking weights: {weights.map((w) => `${w.label} ${w.pct}%`).join(', ')}"
			>
				{#each weights as w (w.k)}
					<span style="width: {w.pct}%; background: var(--color-c-{w.k})"></span>
				{/each}
			</div>
			<ul class="mt-1 flex flex-wrap gap-x-3 text-micro text-ink-2" aria-hidden="true">
				{#each weights as w (w.k)}
					<li class="inline-flex items-center gap-1">
						<span class="size-1.5 rounded-full" style="background: var(--color-c-{w.k})"></span>
						{w.label} <span class="mono text-ink">{w.pct}%</span>
					</li>
				{/each}
			</ul>
			{#if rules.originPrefer.length}
				<p class="mt-1.5 text-meta text-ink-2">
					Finnish preferred: {rules.originPrefer.join(', ')}
				</p>
			{/if}

			{#if !previews.length && preset !== 'kitchen'}
				<p
					class="mt-3 rounded-md bg-well px-3 py-2 text-meta leading-snug text-ink-2"
					role="status"
				>
					Your order already follows {PICKED_BY[preset].toLowerCase()}: these rules pick the same
					rescues.
				</p>
			{/if}
			{#if previews.length}
				<div
					class="mt-3 rounded-md border border-propose/30 bg-propose-wash px-3 py-2.5"
					role="status"
				>
					<p class="flex items-start gap-2 text-meta leading-snug text-ink">
						<Eye size={15} class="mt-px shrink-0 text-propose" aria-hidden="true" />
						<span>
							<b class="font-medium">Previewing {PICKED_BY[preset].toLowerCase()}.</b> Your order is unchanged
							until you apply.
						</span>
					</p>
					<ul class="mt-2 space-y-1.5 text-meta leading-snug">
						{#each previews as p (p.dish)}
							<li class={p.ordered ? 'text-ink-3' : ''}>
								<span class="font-medium {p.ordered ? 'text-ink-2' : 'text-ink'}">{p.dish}:</span>
								<span>order has {list(p.saved)}</span>
								{#if p.ordered}
									<span class="flex items-center gap-1"
										><Lock size={12} aria-hidden="true" /> already ordered: stays as ordered</span
									>
								{:else}
									<span class="block text-propose">these rules pick {list(p.recommended)}</span>
									{#if delta(p.saved, p.recommended)}<span class="mono block text-ink-2"
											>{delta(p.saved, p.recommended)}</span
										>{/if}
								{/if}
							</li>
						{/each}
					</ul>
					<button
						type="button"
						class="mt-2.5 h-9 w-full rounded-md bg-propose px-3 text-body font-medium text-sheet hover:opacity-90 disabled:cursor-not-allowed disabled:bg-well disabled:text-ink-3 disabled:hover:opacity-100"
						disabled={busy || !!applyBlocked}
						title={applyBlocked ?? undefined}
						aria-describedby={applyBlocked ? 'apply-why' : undefined}
						onclick={onapply}>Apply these rules to the order</button
					>
					{#if applyBlocked}
						<p id="apply-why" class="mt-1.5 flex gap-1.5 text-meta leading-snug text-ink">
							<Lock size={13} class="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
							{applyBlocked}
						</p>
					{:else}
						<p class="mt-1.5 text-micro leading-snug text-ink-3">
							Replaces the substitute, re-quotes, and voids the current approval: you review the new
							terms before anything is bought.{#if locked.length}
								{` ${locked.map((p) => p.dish).join(', ')}`}
								{locked.length === 1 ? 'is' : 'are'} already ordered and {locked.length === 1
									? 'stays'
									: 'stay'} as ordered.{/if}
						</p>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</section>
