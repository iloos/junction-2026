<script lang="ts">
	import { CornerDownLeft } from '@lucide/svelte';
	import type { AnswerSpec, ReqUnit, RequestAnswer } from './types';

	/** Answer a lookup question in place: pick one of the offered options, or type an amount. */
	interface Props {
		spec: AnswerSpec;
		busy: boolean;
		onanswer: (a: RequestAnswer) => void;
	}
	let { spec, busy, onanswer }: Props = $props();

	const UNIT_LABEL: Record<ReqUnit, string> = {
		l: 'l',
		kg: 'kg',
		pcs: 'pcs',
		case: 'cases',
		sales: 'sales units'
	};
	const units = $derived(
		spec.kind === 'qty' ? spec.units : (spec.alsoQty?.units ?? ([] as ReqUnit[]))
	);
	let qty = $state('');
	let unit = $state<ReqUnit | ''>('');
	const chosenUnit = $derived<ReqUnit>(unit || units[0]);
	const value = $derived(Number(qty.replace(',', '.')));
	const valid = $derived(Number.isFinite(value) && value > 0 && value <= 1e6);

	function send(e: SubmitEvent) {
		e.preventDefault();
		if (valid) onanswer({ item: spec.item, qty: value, unit: chosenUnit });
	}
</script>

<div class="space-y-2 border-t border-signoff/25 bg-signoff-wash/60 px-3 pt-1 pb-3">
	{#if spec.kind === 'choice' && spec.options.length}
		<ul class="grid gap-1.5 sm:grid-cols-2" aria-label="Answers">
			{#each spec.options as o (o.answer.productId)}
				<li>
					<button
						type="button"
						disabled={busy}
						onclick={() => onanswer(o.answer)}
						class="block h-full w-full rounded-lg border border-rule-strong bg-sheet px-3 py-2 text-left hover:border-accent/60 disabled:opacity-50"
					>
						<span class="num block text-body font-medium text-ink">{o.label}</span>
						<span class="mt-0.5 block text-meta leading-snug text-ink-2">{o.detail}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	{#if units.length}
		<form class="flex flex-wrap items-center gap-2" onsubmit={send}>
			<label class="text-body text-ink-2" for="ans-{spec.item}">
				{spec.kind === 'choice' ? 'Or give the amount:' : 'Amount:'}
			</label>
			<input
				id="ans-{spec.item}"
				bind:value={qty}
				inputmode="decimal"
				placeholder="e.g. 40"
				class="num h-9 w-24 rounded-md border border-rule-strong bg-sheet px-2 text-body"
			/>
			{#if spec.kind === 'qty' && spec.salesUnit}
				<span class="text-body text-ink-2">{spec.salesUnit}</span>
			{:else}
				<select
					value={chosenUnit}
					onchange={(e) => (unit = e.currentTarget.value as ReqUnit)}
					aria-label="Unit"
					class="h-9 rounded-md border border-rule-strong bg-sheet px-2 text-body"
				>
					{#each units as u (u)}<option value={u}>{UNIT_LABEL[u]}</option>{/each}
				</select>
			{/if}
			<button
				type="submit"
				disabled={busy || !valid}
				class="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-body font-medium text-sheet disabled:opacity-40"
			>
				Use this <CornerDownLeft size={14} aria-hidden="true" />
			</button>
		</form>
	{/if}
</div>
