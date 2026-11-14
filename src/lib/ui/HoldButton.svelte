<script lang="ts">
	/**
	 * Hold to confirm: no accidental tap approves money. The hold is an accelerator; a tap or a press of Enter/Space
	 * arms a plain "Confirm exact terms" button (focused, then click or Enter), so sign-off never needs a sustained
	 * gesture (keyboard, switch and screen-reader users).
	 */
	import { tick } from 'svelte';
	interface Props {
		label: string;
		holdMs?: number;
		disabled?: boolean;
		onconfirm: () => void;
	}
	let { label, holdMs = 900, disabled = false, onconfirm }: Props = $props();

	let progress = $state(0);
	let armed = $state(false);
	let confirmEl = $state<HTMLButtonElement | null>(null);
	async function arm() {
		armed = true;
		await tick();
		confirmEl?.focus();
	}
	function confirm() {
		armed = false;
		onconfirm();
	}
	let raf = 0;
	let start = 0;

	function begin(e: Event) {
		if (disabled || raf) return;
		e.preventDefault();
		start = performance.now();
		const tick = (t: number) => {
			progress = Math.min(1, (t - start) / holdMs);
			if (progress >= 1) {
				raf = 0;
				progress = 0;
				armed = false;
				onconfirm();
				return;
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
	}
	function cancel() {
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
		progress = 0;
	}
	/** Let go before the hold completed: a tap, so offer the explicit confirm instead. */
	function release() {
		const wasHolding = raf !== 0;
		cancel();
		if (wasHolding && !disabled) void arm();
	}
	// A hold never survives losing focus or the button going away.
	$effect(() => () => cancel());

	function key(e: KeyboardEvent) {
		if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) begin(e);
	}
	function keyup(e: KeyboardEvent) {
		if (e.key === ' ' || e.key === 'Enter') release();
	}
</script>

<button
	type="button"
	class="relative isolate flex h-11 w-full items-center justify-center overflow-hidden rounded-md bg-ink px-4 text-body font-medium text-sheet select-none disabled:cursor-not-allowed disabled:opacity-40"
	{disabled}
	onpointerdown={begin}
	onpointerup={release}
	onpointerleave={cancel}
	onpointercancel={cancel}
	onblur={cancel}
	onkeydown={key}
	onkeyup={keyup}
	oncontextmenu={(e) => e.preventDefault()}
>
	<span
		class="absolute inset-y-0 left-0 -z-10 bg-accent"
		style="width: {progress * 100}%"
		aria-hidden="true"
	></span>
	{progress > 0 ? 'Keep holding…' : label}
</button>
{#if armed}
	<div class="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Confirm sign-off">
		<button
			bind:this={confirmEl}
			type="button"
			class="inline-flex h-10 items-center rounded-md bg-ink px-4 text-body font-medium text-sheet disabled:opacity-40"
			{disabled}
			onclick={confirm}>Confirm exact terms</button
		>
		<button
			type="button"
			class="inline-flex h-10 items-center rounded-md border border-rule-strong px-3 text-body text-ink"
			onclick={() => (armed = false)}>Cancel</button
		>
		<span class="text-meta text-ink-3">Or hold the button above.</span>
	</div>
{/if}
