<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { X } from '@lucide/svelte';
	import type { Line } from '$lib/core/contracts';
	import SourceTag from './SourceTag.svelte';
	import StateChip from './StateChip.svelte';
	import { money, num } from './format';

	interface Step {
		text: string;
		source: string;
		detail?: string;
	}
	interface Props {
		open: boolean;
		line: Line | null;
		productName: string;
		dishName: string;
		steps: Step[];
		onclose: () => void;
	}
	let { open, line, productName, dishName, steps, onclose }: Props = $props();
</script>

<Dialog.Root
	{open}
	onOpenChange={(o) => {
		if (!o) onclose();
	}}
>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-40 bg-ink/20" />
		<Dialog.Content
			class="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-rule bg-sheet shadow-[-12px_0_32px_-12px_oklch(0.2_0.02_255/0.25)] outline-none"
		>
			{#if line}
				<header class="border-b border-rule px-5 pt-4 pb-4">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="text-[12.5px] text-ink-3">Why this line · {dishName}</p>
							<Dialog.Title
								class="mt-1 text-[17px] leading-snug font-semibold text-balance text-ink"
							>
								{productName}
							</Dialog.Title>
							<p class="mono mt-1 text-[12.5px] text-ink-3">{line.productId} · {line.id}</p>
						</div>
						<Dialog.Close
							class="grid size-8 shrink-0 place-items-center rounded-md text-ink-2 hover:bg-well hover:text-ink"
							aria-label="Close"><X size={17} /></Dialog.Close
						>
					</div>
					<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
						<StateChip state={line.state} tier={line.tier} reasons={line.reasons} />
						<span class="mono text-ink">{num(line.qty.value)} {line.qty.unit}</span>
						<span class="mono text-ink">{money(line.lineCents)}</span>
					</div>
				</header>
				<Dialog.Description class="sr-only"
					>Ordered reasoning steps with their sources</Dialog.Description
				>
				<ol class="flex-1 overflow-y-auto px-5 py-4">
					{#each steps as step, i (i)}
						<li class="relative grid grid-cols-[22px_1fr] gap-x-3 pb-4 last:pb-1">
							{#if i < steps.length - 1}
								<span class="absolute top-6 bottom-0 left-[10px] w-px bg-rule" aria-hidden="true"
								></span>
							{/if}
							<span
								class="mono z-10 mt-px grid size-[21px] place-items-center rounded-full border border-rule-strong bg-sheet text-[11px] text-ink-2"
								>{i + 1}</span
							>
							<div class="min-w-0">
								<div class="flex items-start justify-between gap-3">
									<p class="text-[13.5px] leading-[1.45] text-pretty text-ink">{step.text}</p>
									<SourceTag source={step.source} compact />
								</div>
								{#if step.detail}
									<p class="mt-0.5 text-[12.5px] leading-snug text-ink-3">{step.detail}</p>
								{/if}
							</div>
						</li>
					{/each}
				</ol>
				<footer class="border-t border-rule px-5 py-3 text-[12px] leading-snug text-ink-3">
					Valio prices and availability come from the challenge mock (cached 14 Nov). Booking,
					recipe and yields are scenario data or team estimates until a chef checks them.
				</footer>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
