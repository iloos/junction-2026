<script lang="ts">
	import { Minus, Plus } from '@lucide/svelte';

	interface Props {
		value: number;
		original: number;
		step?: number;
		label: string;
		onchange: (v: number) => void;
	}
	let { value, original, step = 5, label, onchange }: Props = $props();
	let draft = $derived(String(value));

	function commit(v: number) {
		const n = Math.max(1, Math.min(1000, Math.round(v)));
		if (Number.isFinite(n) && n !== value) onchange(n);
		else draft = String(value);
	}
	const edited = $derived(value !== original);
</script>

<div class="inline-flex flex-col items-end gap-0.5">
	<div
		class="inline-flex h-8 items-center rounded-md border bg-sheet {edited
			? 'border-accent/60'
			: 'border-rule-strong'}"
	>
		<button
			type="button"
			class="grid h-full w-7 place-items-center rounded-l-md text-ink-2 hover:bg-well hover:text-ink"
			aria-label="Less {label}"
			onclick={() => commit(value - step)}><Minus size={13} /></button
		>
		<input
			class="mono h-full w-10 border-x border-rule bg-transparent text-center text-[13.5px] text-ink outline-none focus:bg-accent-wash"
			inputmode="numeric"
			aria-label="{label}, grams per guest"
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
			class="grid h-full w-7 place-items-center rounded-r-md text-ink-2 hover:bg-well hover:text-ink"
			aria-label="More {label}"
			onclick={() => commit(value + step)}><Plus size={13} /></button
		>
	</div>
	{#if edited}
		<button
			type="button"
			class="text-[11px] text-ink-3 underline decoration-dotted underline-offset-2 hover:text-ink"
			onclick={() => onchange(original)}>was {original} g</button
		>
	{/if}
</div>
