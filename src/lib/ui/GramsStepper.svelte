<script lang="ts">
	import { Lock, Minus, Plus, LoaderCircle } from '@lucide/svelte';

	interface Props {
		value: number;
		original: number;
		step?: number;
		label: string;
		/** A requested value the server hasn't confirmed yet: shown, not editable. */
		pending?: number;
		disabled?: boolean;
		/** A one-line table row: shorter, no "was" line under it (the row's detail says what it was). */
		compact?: boolean;
		onchange: (v: number) => void;
	}
	let {
		value,
		original,
		step = 5,
		label,
		pending,
		disabled = false,
		compact = false,
		onchange
	}: Props = $props();
	const shown = $derived(pending ?? value);
	const locked = $derived(disabled || pending !== undefined);
	let draft = $derived(String(shown));

	// One change at a time: while a change is pending the controls are locked, so edits never race.
	function commit(v: number) {
		if (locked) return;
		const n = Math.max(1, Math.min(1000, Math.round(v)));
		if (Number.isFinite(n) && n !== value) onchange(n);
		else draft = String(value);
	}
	const edited = $derived(shown !== original);
</script>

<div class="inline-flex flex-col items-end gap-0.5">
	{#if disabled && pending === undefined}
		<!-- Locked (ordered, or not editable here): no controls to press, so it can't be mistaken for one. -->
		<p
			class="inline-flex {compact
				? 'h-8'
				: 'h-9'} items-center gap-1.5 rounded-md border border-dashed border-rule-strong bg-well px-2.5 text-ink-2"
			aria-label="{label}: {shown} grams per guest, locked"
		>
			<Lock size={13} aria-hidden="true" />
			<span class="mono text-body text-ink">{shown}</span>
			<span class="text-meta">g</span>
		</p>
	{:else}
		<div
			class="inline-flex {compact ? 'h-8' : 'h-9'} items-center rounded-md border bg-sheet {edited
				? 'border-accent/60'
				: 'border-rule-strong'} {locked ? 'opacity-70' : ''}"
			aria-busy={pending !== undefined}
		>
			<button
				type="button"
				class="grid h-full {compact
					? 'w-7'
					: 'w-9'} place-items-center rounded-l-md text-ink-2 hover:bg-well hover:text-ink disabled:cursor-not-allowed disabled:hover:bg-transparent"
				aria-label="Less {label}"
				disabled={locked}
				onclick={() => commit(shown - step)}><Minus size={14} /></button
			>
			<input
				class="mono h-full {compact
					? 'w-10'
					: 'w-11'} border-x border-rule bg-transparent text-center text-body text-ink outline-none focus:bg-accent-wash disabled:cursor-not-allowed"
				inputmode="numeric"
				aria-label="{label}, grams per guest"
				disabled={locked}
				bind:value={draft}
				onkeydown={(e) => {
					if (e.key === 'Enter') commit(Number(draft));
					if (e.key === 'ArrowUp') {
						e.preventDefault();
						commit(value + 1);
					}
					if (e.key === 'ArrowDown') {
						e.preventDefault();
						commit(value - 1);
					}
				}}
				onblur={() => commit(Number(draft))}
			/>
			<button
				type="button"
				class="grid h-full {compact
					? 'w-7'
					: 'w-9'} place-items-center rounded-r-md text-ink-2 hover:bg-well hover:text-ink disabled:cursor-not-allowed disabled:hover:bg-transparent"
				aria-label="More {label}"
				disabled={locked}
				onclick={() => commit(shown + step)}><Plus size={14} /></button
			>
		</div>
	{/if}
	{#if compact}
		<!-- The row stays one line: the pending state shows as the locked control; "was" is in the detail. -->
	{:else if pending !== undefined}
		<span class="inline-flex items-center gap-1 text-micro text-accent-ink" role="status">
			<LoaderCircle size={11} class="animate-spin" aria-hidden="true" /> recomputing
		</span>
	{:else if edited}
		<button
			type="button"
			class="text-micro text-ink-3 underline decoration-dotted underline-offset-2 hover:text-ink disabled:no-underline"
			disabled={locked}
			onclick={() => onchange(original)}>was {original} g</button
		>
	{/if}
</div>
