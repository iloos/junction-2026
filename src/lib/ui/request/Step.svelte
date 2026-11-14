<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Check, CircleAlert, CircleDashed, LoaderCircle, OctagonX } from '@lucide/svelte';

	/** One step of Request → Lookup → Order → Approval: a numbered rail, a title, its sources, and its body. */
	interface Props {
		n: number;
		title: string;
		status: 'idle' | 'running' | 'done' | 'warn' | 'blocked' | 'error';
		ms?: number | null;
		last?: boolean;
		sources?: Snippet;
		children?: Snippet;
	}
	let { n, title, status, ms = null, last = false, sources, children }: Props = $props();

	const META = {
		idle: { icon: CircleDashed, cls: 'text-ink-3 border-rule bg-sheet', word: 'waiting' },
		running: {
			icon: LoaderCircle,
			cls: 'text-accent border-accent/40 bg-accent-wash',
			word: 'working'
		},
		done: { icon: Check, cls: 'text-sheet border-accent bg-accent', word: 'done' },
		warn: {
			icon: CircleAlert,
			cls: 'text-signoff border-signoff/50 bg-signoff-wash',
			word: 'check'
		},
		blocked: {
			icon: CircleAlert,
			cls: 'text-signoff border-signoff/50 bg-signoff-wash',
			word: 'needs you'
		},
		error: { icon: OctagonX, cls: 'text-out border-out/40 bg-out-wash', word: 'failed' }
	} as const;
	const m = $derived(META[status]);
</script>

<li
	class="relative grid grid-cols-[2rem_1fr] gap-x-3 sm:gap-x-4"
	aria-current={status === 'running' ? 'step' : undefined}
	data-testid="step-card"
	data-step={title.toLowerCase()}
	data-status={status}
>
	<div class="relative flex flex-col items-center">
		<span
			class="z-10 flex size-8 items-center justify-center rounded-full border text-body font-medium {m.cls}"
			title={m.word}
		>
			{#if status === 'idle'}
				<span class="num">{n}</span>
			{:else}
				<m.icon
					size={16}
					strokeWidth={2.4}
					class={status === 'running' ? 'animate-spin' : ''}
					aria-hidden="true"
				/>
			{/if}
		</span>
		{#if !last}
			<span
				class="w-px flex-1 {status === 'done' || status === 'warn' ? 'bg-accent/40' : 'bg-rule'}"
				aria-hidden="true"
			></span>
		{/if}
	</div>
	<section class="min-w-0 pb-7" aria-label={title}>
		<header class="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
			<h2
				class="text-heading font-semibold tracking-[-0.005em] {status === 'idle'
					? 'text-ink-3'
					: 'text-ink'}"
			>
				{title}
			</h2>
			<span class="sr-only">{m.word}</span>
			{#if sources}<span class="flex flex-wrap items-center gap-1.5">{@render sources()}</span>{/if}
			{#if ms !== null && status !== 'idle' && status !== 'running'}
				<span class="mono ml-auto text-micro text-ink-3">{ms} ms</span>
			{/if}
		</header>
		{#if children && status !== 'idle'}
			<div class="mt-2">{@render children()}</div>
		{/if}
	</section>
</li>
