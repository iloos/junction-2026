<script lang="ts">
	/** Hold to confirm: no accidental tap approves money. Keyboard: hold Space or Enter. */
	interface Props {
		label: string;
		holdMs?: number;
		disabled?: boolean;
		onconfirm: () => void;
	}
	let { label, holdMs = 900, disabled = false, onconfirm }: Props = $props();

	let progress = $state(0);
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
	function key(e: KeyboardEvent) {
		if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) begin(e);
	}
	function keyup(e: KeyboardEvent) {
		if (e.key === ' ' || e.key === 'Enter') cancel();
	}
</script>

<button
	type="button"
	class="relative isolate flex h-11 w-full items-center justify-center overflow-hidden rounded-md bg-ink px-4 text-[14px] font-medium text-sheet select-none disabled:cursor-not-allowed disabled:opacity-40"
	{disabled}
	onpointerdown={begin}
	onpointerup={cancel}
	onpointerleave={cancel}
	onpointercancel={cancel}
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
