<script lang="ts">
	/**
	 * A dish's one status, as a chip of fixed height: icon and a short word (dishChipWord); the full sentence
	 * (dishStatus) is the chip's tooltip and is said again when the row opens.
	 */
	import { CircleCheck, CircleHelp, CircleX, Clock, PenLine, ShieldCheck } from '@lucide/svelte';
	import type { FulfilmentView } from '$lib/core/contracts';
	import { dishChipWord, dishStatus, type DishGate, type DishTone } from './coverage';

	let {
		f,
		gate = null,
		rescued = false
	}: { f: FulfilmentView; gate?: DishGate; rescued?: boolean } = $props();

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
	const CLS: Record<DishTone, string> = {
		confirmed: 'border-sup-confirmed/50 text-sup-confirmed',
		covered: 'border-sup-known/50 text-sup-known',
		awaiting: 'border-rule-strong text-ink-2',
		approve: 'border-propose/60 border-dashed text-propose',
		signoff: 'border-auth text-auth',
		unknown: 'border-sup-unknown/70 border-dotted text-sup-unknown',
		missing: 'border-sup-missing/60 text-sup-missing'
	};
	const Icon = $derived(ICON[s.tone]);
</script>

<span
	class="inline-flex h-6 max-w-full items-center gap-1 rounded-full border bg-sheet px-2 text-meta font-medium whitespace-nowrap {CLS[
		s.tone
	]}"
	title={s.detail ? `${s.text} · ${s.detail}` : s.text}
	data-dish-status={s.tone}
>
	<Icon size={13} class="shrink-0" aria-hidden="true" />
	<span class="truncate">{dishChipWord(s.tone, rescued)}</span>
	<span class="sr-only">: {s.text}</span>
</span>
