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

<div class="ops-root" data-theme="dark" data-scale="wall">{@render children()}</div>

<style>
	/*
	 * Control room: the shared tokens (routes/layout.css) in their dark theme, sized for a wall (+4 px). The short
	 * names below are what every Ops component reads; each one is a shared token, so Ops and the kitchen agree.
	 */
	.ops-root {
		--bg: var(--color-paper);
		--panel: var(--color-sheet);
		--raise: var(--color-well);
		--line: var(--color-rule);
		--text: var(--color-ink);
		--muted: var(--color-ink-2);
		--faint: var(--color-ink-3);
		--act: var(--color-ink-2);
		--propose: var(--color-auth);
		--sign-off: var(--color-signoff);
		--blocked: var(--color-out);
		--done: var(--color-sup-confirmed);
		--outside: var(--color-undeliv);
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
		font-size: var(--text-body);
		line-height: var(--text-body--line-height);
		font-variant-numeric: tabular-nums;
		color-scheme: dark;
	}
	/*
	 * Neutral dark surfaces for the control room: the Kitchen's warm paper hue (85) at low chroma, so Ops reads as
	 * the same product at wall scale and colour is left to state (propose, sign-off, out, ok). Applied to the
	 * whole page (the shell's header carries data-theme too) only while /ops is open.
	 */
	:global(html[data-theme='dark']),
	:global(html[data-theme='dark'] [data-theme='dark']) {
		--color-paper: oklch(0.185 0.004 85);
		--color-sheet: oklch(0.215 0.005 85);
		--color-well: oklch(0.25 0.006 85);
		--color-rule: oklch(0.32 0.007 85);
		--color-rule-strong: oklch(0.42 0.008 85);
		--color-ink: oklch(0.94 0.006 85);
		--color-ink-2: oklch(0.78 0.008 85);
		--color-ink-3: oklch(0.66 0.008 85);
		--color-accent-wash: oklch(0.3 0.035 195);
		--color-propose-wash: oklch(0.3 0.04 252);
		--color-auth-wash: oklch(0.3 0.04 252);
		--color-sup-excess: oklch(0.55 0.006 85);
	}
	.ops-root :global(:focus-visible) {
		outline: 2px solid var(--propose);
		outline-offset: 2px;
	}
</style>
