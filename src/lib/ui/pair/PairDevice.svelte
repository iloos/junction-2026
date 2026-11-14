<script lang="ts">
	/**
	 * "Open this kitchen on another device": a QR code (a one-time link) and a short code, minted for this browser's own
	 * sandbox. The chef approves on the phone what an agent proposed elsewhere (D17). Nothing here reaches an agent.
	 */
	import { MonitorSmartphone, RefreshCw } from '@lucide/svelte';
	import { encode } from 'uqr';

	let pairing = $state<{ code: string; link: string; expiresAt: string } | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);
	let now = $state(Date.now());

	/** The QR code's modules for the one-time link, drawn as SVG cells (no HTML injection). */
	const qr = $derived(pairing ? encode(pairing.link, { border: 2 }) : null);
	const left = $derived(pairing ? Math.max(0, Date.parse(pairing.expiresAt) - now) : 0);
	const mmss = (ms: number) =>
		`${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

	$effect(() => {
		if (!pairing) return;
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});

	async function mint() {
		busy = true;
		error = null;
		try {
			const r = await fetch('/pair/new', { method: 'POST' });
			const body = await r.json();
			if (!r.ok) throw new Error(body?.error?.message ?? `HTTP ${r.status}`);
			pairing = body;
			now = Date.now();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<section class="rounded-lg border border-rule bg-sheet p-4 sm:p-5" aria-labelledby="pair">
	<h2 id="pair" class="flex items-center gap-2 font-semibold">
		<MonitorSmartphone size={18} aria-hidden="true" /> Open this kitchen on another device
	</h2>
	<p class="mt-1 text-sm text-ink-2">
		Approve on your phone what your agent proposed here. Scan the code, or type it at
		<span class="font-medium">/pair</span>. It works once, for 10 minutes, and never reaches an
		agent.
	</p>
	{#if pairing && left > 0}
		<div class="mt-3 flex flex-wrap items-center gap-4" data-testid="pair-ready">
			{#if qr}
				<svg
					class="size-36 shrink-0 rounded bg-white"
					viewBox="0 0 {qr.size} {qr.size}"
					shape-rendering="crispEdges"
					role="img"
					aria-label="QR code for the one-time link"
				>
					{#each qr.data as row, y (y)}
						{#each row as on, x (x)}
							{#if on}<rect {x} {y} width="1" height="1" fill="#000" />{/if}
						{/each}
					{/each}
				</svg>
			{/if}
			<div>
				<p class="text-sm text-ink-2">Or type this code:</p>
				<p class="font-mono text-2xl font-semibold tracking-[0.3em]" data-testid="pair-code">
					{pairing.code}
				</p>
				<p class="mt-1 text-meta text-ink-3">Expires in {mmss(left)}</p>
			</div>
		</div>
	{:else}
		<button
			type="button"
			class="mt-3 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-sheet hover:bg-accent-ink disabled:opacity-50"
			disabled={busy}
			onclick={mint}
		>
			{#if pairing}<RefreshCw size={14} aria-hidden="true" /> Make a new code{:else}Show a code{/if}
		</button>
	{/if}
	{#if error}<p class="mt-2 text-sm text-signoff" role="alert">{error}</p>{/if}
</section>
