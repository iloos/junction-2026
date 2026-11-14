<script lang="ts">
	/**
	 * One pill for what is real, what is scenario and what is simulated. Replaces the always-open label strip; the
	 * Valio line comes from the offers on screen (their provenance), not fixed copy.
	 */
	import { Popover } from 'bits-ui';
	import { Database, FlaskConical, Info, Receipt, WifiOff } from '@lucide/svelte';

	import { storyTime } from '../format';
	import type { DataLabels } from './shell.svelte';

	let { labels }: { labels: DataLabels | null } = $props();
	const offline = $derived(labels?.offline ?? false);
</script>

<Popover.Root>
	<Popover.Trigger
		class="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-meta font-medium {offline
			? 'border-signoff/50 bg-signoff-wash text-ink'
			: 'border-rule-strong text-ink-2 hover:text-ink'}"
		aria-label="Where this data comes from"
	>
		{#if offline}<WifiOff size={13} aria-hidden="true" />{:else}<Info
				size={13}
				aria-hidden="true"
			/>{/if}
		<span class="hidden sm:inline">{offline ? 'Offline stand-in' : 'Demo data'}</span>
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			sideOffset={6}
			align="end"
			class="z-50 w-[min(340px,calc(100vw-24px))] rounded-lg border border-rule bg-sheet p-3 text-meta text-ink-2 shadow-lg"
		>
			<p class="mb-2 text-body font-semibold text-ink">Where this data comes from</p>
			<ul class="grid gap-2.5">
				<li class="flex gap-2">
					<Database size={15} class="mt-px shrink-0 text-accent" aria-hidden="true" />
					<span
						><b class="font-medium text-ink">Valio challenge mock:</b> products, prices and stock.
						{#if labels?.source}{labels.source.live ? 'Fetched' : 'Cached'}
							{storyTime(labels.source.at)}.{:else}No prices on screen yet.{/if}</span
					>
				</li>
				<li class="flex gap-2">
					<FlaskConical size={15} class="mt-px shrink-0 text-undeliv" aria-hidden="true" />
					<span
						><b class="font-medium text-ink">Scenario:</b> the booking, stock on hand, recipes and the
						December clock.</span
					>
				</li>
				<li class="flex gap-2">
					<Receipt size={15} class="mt-px shrink-0 text-ink-3" aria-hidden="true" />
					<span
						><b class="font-medium text-ink">Simulated:</b> orders are a local commitment; nothing is
						sent to Valio.</span
					>
				</li>
				{#if offline}
					<li class="flex gap-2 rounded-md bg-signoff-wash p-2">
						<WifiOff size={15} class="mt-px shrink-0 text-signoff" aria-hidden="true" />
						<span
							><b class="font-medium text-ink">Offline stand-in:</b> a browser copy of the seeded plan,
							not the live order. Coverage and pack figures are the server's recorded output, so editing
							grams here does not move them.</span
						>
					</li>
				{/if}
			</ul>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
