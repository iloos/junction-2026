<script lang="ts">
	import { sourceLabel } from './sources';

	let { source, compact = false }: { source: string; compact?: boolean } = $props();
	const s = $derived(sourceLabel(source));
	const CLS = {
		valio: 'text-accent-ink border-accent/35',
		scenario: 'text-undeliv border-undeliv/35 border-dashed',
		estimate: 'text-signoff border-signoff/40 border-dotted',
		chef: 'text-ink border-ink/40',
		rule: 'text-propose border-propose/35'
	} as const;
</script>

<span
	class="inline-flex shrink-0 items-center rounded-full border px-2 leading-none whitespace-nowrap {compact
		? 'h-5 text-[11px]'
		: 'h-[22px] text-[11.5px]'} {CLS[s.family]}">{s.label}</span
>
