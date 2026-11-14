<script lang="ts">
	/**
	 * One small zone (D26): the same kitchen, the same baskets, from a phone (pair it with a one-time QR code) or from
	 * the chef's own AI agent (the agent key and MCP config on /agents). Nothing here changes a rule or grants more.
	 */
	import { Popover } from 'bits-ui';
	import { Bot, Smartphone } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import PairDevice from './pair/PairDevice.svelte';
</script>

<section
	class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-rule bg-sheet px-4 py-3 text-meta text-ink-2"
	aria-label="Use this kitchen elsewhere"
>
	<span class="text-ink">Use this kitchen from</span>
	<Popover.Root>
		<Popover.Trigger
			class="inline-flex items-center gap-1.5 rounded-md border border-rule-strong px-2.5 py-1 text-ink hover:border-accent"
			><Smartphone size={14} aria-hidden="true" />your phone</Popover.Trigger
		>
		<Popover.Portal>
			<Popover.Content
				sideOffset={6}
				align="start"
				class="z-50 w-[min(320px,calc(100vw-24px))] rounded-lg border border-rule bg-sheet p-3 shadow-lg"
				><PairDevice /></Popover.Content
			>
		</Popover.Portal>
	</Popover.Root>
	<a
		href={resolve('/agents')}
		class="inline-flex items-center gap-1.5 rounded-md border border-rule-strong px-2.5 py-1 text-ink hover:border-accent"
		><Bot size={14} aria-hidden="true" />your own AI agent</a
	>
	<span class="basis-full text-ink-3 sm:basis-auto"
		>Same kitchen, same baskets: what you plan there shows here.</span
	>
</section>
