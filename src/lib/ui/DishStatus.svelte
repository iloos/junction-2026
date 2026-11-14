<script lang="ts">
	/**
	 * A dish's cover as one icon and one sentence (dishStatus): readable in five seconds, no encoded bar. The
	 * ruler with the amounts lives in the Why drawer.
	 */
	import { CircleCheck, CircleHelp, CircleX, Clock, PenLine, ShieldCheck } from '@lucide/svelte';
	import type { FulfilmentView } from '$lib/core/contracts';
	import { dishStatus, type DishGate, type DishTone } from './coverage';

	let { f, gate = null }: { f: FulfilmentView; gate?: DishGate } = $props();

	const s = $derived(dishStatus(f, gate));
	const ICON = {
		confirmed: CircleCheck,
		covered: CircleCheck,
		awaiting: Clock,
		approve: ShieldCheck,
		signoff: PenLine,
		unknown: CircleHelp,
		missing: CircleX
	} as const;
	const TONE: Record<DishTone, string> = {
		confirmed: 'text-sup-confirmed',
		covered: 'text-sup-known',
		awaiting: 'text-ink-2',
		approve: 'text-propose',
		signoff: 'text-signoff',
		unknown: 'text-sup-unknown',
		missing: 'text-sup-missing'
	};
	const Icon = $derived(ICON[s.tone]);
</script>

<p class="flex items-start gap-1.5 text-body leading-snug" data-dish-status={s.tone}>
	<Icon size={16} class="mt-0.5 shrink-0 {TONE[s.tone]}" aria-hidden="true" />
	<span class="min-w-0">
		<span class="font-medium text-ink">{s.text}</span>
		{#if s.detail}<span class="text-meta text-ink-2"> · {s.detail}</span>{/if}
	</span>
</p>
