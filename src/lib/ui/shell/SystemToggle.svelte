<script lang="ts">
	/**
	 * Plain words by default; the System layer overlays the mechanics (formula, funnel, gate, seal, op ids).
	 * Mirrored to `?system=1` so a judge's link opens with it on.
	 */
	import { Cpu } from '@lucide/svelte';

	let { on, ontoggle }: { on: boolean; ontoggle: () => void } = $props();
</script>

<button
	type="button"
	class="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-meta font-medium {on
		? 'border-ink bg-ink text-sheet'
		: 'border-rule-strong text-ink-2 hover:text-ink'}"
	aria-pressed={on}
	title="Show how the system works: formulas, gates, hashes and op ids"
	onclick={ontoggle}
>
	<Cpu size={13} aria-hidden="true" />
	<span class="hidden sm:inline">System</span>
</button>
