<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { X } from '@lucide/svelte';
	import type { Line } from '$lib/core/contracts';
	import SourceTag from './SourceTag.svelte';
	import StateChip from './StateChip.svelte';
	import { money, num } from './format';
	import type { WhyChain } from './why-chain';

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
		/** The worked calculation, dish to rule (built from the plan's own numbers). */
		chain?: WhyChain | null;
		onclose: () => void;
	}
	let { open, line, productName, dishName, steps, chain = null, onclose }: Props = $props();
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
							<p class="text-meta text-ink-3">Why this line · {dishName}</p>
							<Dialog.Title
								class="mt-1 text-title leading-snug font-semibold text-balance text-ink"
							>
								{productName}
							</Dialog.Title>
							<p class="mono mt-1 text-meta text-ink-3">{line.productId} · {line.id}</p>
						</div>
						<Dialog.Close
							class="grid size-8 shrink-0 place-items-center rounded-md text-ink-2 hover:bg-well hover:text-ink"
							aria-label="Close"><X size={17} /></Dialog.Close
						>
					</div>
					<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-body">
						<StateChip
							state={line.state}
							tier={line.tier}
							reasons={line.reasons}
							view={line.view}
						/>
						<span class="mono text-ink">{num(line.qty.value)} {line.qty.unit}</span>
						<span class="mono text-ink">{money(line.lineCents)}</span>
					</div>
				</header>
				<Dialog.Description class="sr-only"
					>Ordered reasoning steps with their sources</Dialog.Description
				>
				<div class="flex-1 overflow-y-auto">
					{#if chain}
						<section class="border-b border-rule px-5 py-4" aria-labelledby="chain-h">
							<h3 id="chain-h" class="text-body font-semibold text-ink">
								How the number was worked out
							</h3>
							<dl class="chain mt-2">
								{#each chain.nodes as n, i (i)}
									<div class="node">
										<dt class="text-meta text-ink-3">{n.label}</dt>
										<dd class="min-w-0">
											<div class="flex items-start justify-between gap-3">
												<p class="text-body leading-snug text-ink" class:mono={n.numeric}>
													{n.value}
												</p>
												<SourceTag source={n.source} compact />
											</div>
											{#if n.detail}<p class="mt-0.5 text-meta leading-snug text-ink-3">
													{n.detail}
												</p>{/if}
										</dd>
									</div>
								{/each}
							</dl>
							{#if chain.recipe}
								<div class="mt-3 rounded-md border border-rule bg-well/60 px-3 py-2.5">
									<p class="text-body font-medium text-ink">{chain.recipe.title}</p>
									<p class="mt-0.5 text-meta leading-snug text-ink-2">{chain.recipe.note}</p>
									<ul class="mt-2 space-y-1.5">
										{#each chain.recipe.ingredients as g, i (g.lineId)}
											<li class="grid grid-cols-[30px_1fr] items-start gap-x-2">
												<span class="mono pt-0.5 text-micro text-ink-3">{i === 0 ? '' : 'AND'}</span
												>
												<div
													class="min-w-0 {g.current
														? '-mx-1.5 rounded-sm bg-accent-wash px-1.5 py-0.5'
														: ''}"
												>
													<p class="text-meta leading-snug text-ink">{g.name}</p>
													<p class="mono text-micro text-ink-3">
														{g.buys}{g.rounding ? ` · ${g.rounding}` : ''} · {g.cover}
													</p>
												</div>
											</li>
										{/each}
									</ul>
								</div>
							{/if}
						</section>
					{/if}
					<ol class="px-5 py-4" aria-label="The agent's reasoning">
						{#each steps as step, i (i)}
							<li class="relative grid grid-cols-[22px_1fr] gap-x-3 pb-4 last:pb-1">
								{#if i < steps.length - 1}
									<span class="absolute top-6 bottom-0 left-[10px] w-px bg-rule" aria-hidden="true"
									></span>
								{/if}
								<span
									class="mono z-10 mt-px grid size-[21px] place-items-center rounded-full border border-rule-strong bg-sheet text-micro text-ink-2"
									>{i + 1}</span
								>
								<div class="min-w-0">
									<div class="flex items-start justify-between gap-3">
										<p class="text-body leading-[1.45] text-pretty text-ink">{step.text}</p>
										<SourceTag source={step.source} compact />
									</div>
									{#if step.detail}
										<p class="mt-0.5 text-meta leading-snug text-ink-3">{step.detail}</p>
									{/if}
								</div>
							</li>
						{/each}
					</ol>
				</div>
				<footer class="border-t border-rule px-5 py-3 text-meta leading-snug text-ink-3">
					Valio prices and availability come from the challenge mock (cached 14 Nov). Booking,
					recipe and yields are scenario data or team estimates until a chef checks them.
				</footer>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.chain {
		display: grid;
		gap: 0;
	}
	.node {
		display: grid;
		grid-template-columns: 72px minmax(0, 1fr);
		gap: 0 12px;
		padding: 7px 0;
		border-top: 1px solid var(--color-rule);
	}
	.node:first-child {
		border-top: 0;
	}
</style>
