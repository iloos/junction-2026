<script lang="ts" module>
	/**
	 * The row's fixed tracks (DESIGN.md "The row"): lead (an amount or a time) · text · value · end (state, actions).
	 * Exported so a header row or a subtotal row lines its columns up with the rows beneath it.
	 */
	export const ROW_TRACKS =
		'grid grid-cols-[5rem_minmax(0,1fr)_6rem] gap-x-3 sm:grid-cols-[5rem_minmax(0,1fr)_6rem_minmax(0,auto)]';
</script>

<script lang="ts">
	/**
	 * The one row every list on the Kitchen uses (a basket line, a bill line, a ledger entry, a group subtotal), and
	 * the same row a dock card renders. Text wraps, never truncates; the value is right-aligned in tabular figures in
	 * a fixed column, so amounts line up down a list; the end track holds a state or the row's actions. On a phone the
	 * end track moves under the text.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		/** An amount ("13 packs") or a time ("21:40"): short, mono, the row's first read. */
		lead?: Snippet | string | null;
		/** The row's text: one line that may wrap. */
		children: Snippet;
		/** A quieter second line under the text (what it is for, what it replaces). */
		sub?: Snippet;
		/** Already formatted ("€200.59"), or a snippet for a value that animates. */
		value?: Snippet | string | null;
		/** A state chip or the row's actions. */
		end?: Snippet;
		as?: 'li' | 'div';
		/** A group heading or subtotal: the text is the label, the value the subtotal. */
		head?: boolean;
		/** The row just changed: the tint lands and fades. */
		flash?: boolean;
		/** Not in force (dropped, cannot be ordered): struck and quiet. */
		muted?: boolean;
		class?: string;
	}
	let {
		lead,
		children,
		sub,
		value,
		end,
		as = 'li',
		head = false,
		flash = false,
		muted = false,
		class: cls = ''
	}: Props = $props();
</script>

<svelte:element
	this={as}
	class="{ROW_TRACKS} items-baseline px-3 {head
		? 'bg-paper/60 py-1.5 text-meta font-medium text-ink-2'
		: 'py-2 text-body'} {flash ? 'landed' : ''} {cls}"
>
	<span class="mono text-meta whitespace-nowrap text-ink tabular-nums">
		{#if typeof lead === 'string'}{lead}{:else if lead}{@render lead()}{/if}
	</span>
	<div class="min-w-0 break-words {muted ? 'text-ink-3 line-through decoration-ink-3/60' : ''}">
		{@render children()}
		{#if sub}<div class="mt-0.5 text-meta font-normal text-ink-3">{@render sub()}</div>{/if}
	</div>
	<span
		class="mono text-right tabular-nums {head ? 'text-ink-2' : 'text-ink'} {muted
			? 'text-ink-3'
			: ''}"
	>
		{#if typeof value === 'string'}{value}{:else if value}{@render value()}{/if}
	</span>
	{#if end}
		<span
			class="col-span-2 col-start-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-auto sm:justify-end"
		>
			{@render end()}
		</span>
	{/if}
</svelte:element>
