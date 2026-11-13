<script lang="ts">
	import { Database, FlaskConical, Receipt, WifiOff } from '@lucide/svelte';

	/** The always-visible honesty strip: what is real Valio data, what is scenario, what is simulated. */
	let { mode, cachedAt }: { mode: 'fixture' | 'live'; cachedAt: string } = $props();
</script>

<div
	class="border-b border-rule bg-well text-[12px] text-ink-2"
	role="note"
	aria-label="Data sources"
>
	<div
		class="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-1 px-4 py-1.5 md:px-6"
	>
		<span class="inline-flex items-center gap-1.5">
			<Database size={13} class="text-accent" aria-hidden="true" />
			<span><b class="font-medium text-ink">Valio challenge mock</b> · cached {cachedAt}</span>
		</span>
		<span class="inline-flex items-center gap-1.5">
			<FlaskConical size={13} class="text-undeliv" aria-hidden="true" />
			<span
				>Booking, stock on hand, recipes, December clock: <b class="font-medium text-ink"
					>scenario</b
				></span
			>
		</span>
		<span class="inline-flex items-center gap-1.5">
			<Receipt size={13} class="text-signoff" aria-hidden="true" />
			<span>Orders: <b class="font-medium text-ink">local simulated commitment</b></span>
		</span>
		{#if mode === 'fixture'}
			<span class="inline-flex items-center gap-1.5">
				<WifiOff size={13} aria-hidden="true" />
				<span>Offline fixture</span>
			</span>
		{/if}
	</div>
</div>
