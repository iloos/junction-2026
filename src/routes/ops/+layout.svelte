<script lang="ts">
	let { children } = $props();
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
	/>
</svelte:head>

<div class="ops-root">{@render children()}</div>

<style>
	/* Control room: dark, read at three metres. Cold-store navy rather than black; tiers are words + colour + mark. */
	.ops-root {
		--bg: #0f1e2c;
		--panel: #142636;
		--raise: #1a3044;
		--line: #284256;
		--text: #e4ecf2;
		--muted: #93a9bb;
		--faint: #5f7a8f;
		--act: #a7b8c6;
		--propose: #5aa9ff;
		--sign-off: #f5b544;
		--blocked: #ff6b5e;
		--done: #3cc7b4;
		--outside: #c8a2ff;
		--hatch: repeating-linear-gradient(
			-45deg,
			rgb(255 255 255 / 0.045) 0 6px,
			transparent 6px 12px
		);
		--sans: 'IBM Plex Sans', system-ui, sans-serif;
		--cond: 'IBM Plex Sans Condensed', 'IBM Plex Sans', system-ui, sans-serif;
		--mono: 'IBM Plex Mono', ui-monospace, monospace;

		min-height: 100dvh;
		background: var(--bg);
		color: var(--text);
		font-family: var(--sans);
		font-size: 18px;
		line-height: 1.4;
		font-variant-numeric: tabular-nums;
		color-scheme: dark;
	}
	.ops-root :global(:focus-visible) {
		outline: 2px solid var(--propose);
		outline-offset: 2px;
	}
</style>
