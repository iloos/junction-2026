<script lang="ts">
	/**
	 * The System menu. Plain words by default; "Show how it works" overlays the mechanics (formula, funnel, gate,
	 * seal, op ids), mirrored to `?system=1` so a judge's link opens with it on. "Start over" resets this browser's
	 * own sandbox (POST /api/demo/sandbox/reset) after a confirm that says what it clears; the stage run is never
	 * reset from here.
	 */
	import { Popover } from 'bits-ui';
	import { Cpu, RotateCcw } from '@lucide/svelte';
	import { page } from '$app/state';

	let { on, ontoggle }: { on: boolean; ontoggle: () => void } = $props();

	let open = $state(false);
	let confirming = $state(false);
	let busy = $state(false);
	let note = $state<string | null>(null);
	/** The room this page acts in, when the page says (the Kitchen does); otherwise the visitor's own sandbox. */
	const kind = $derived(
		(page.data as { room?: { kind?: 'own' | 'shared' | 'stage' | 'full' } }).room?.kind ?? 'own'
	);
	const shared = $derived(kind === 'shared' || kind === 'full');
	const consequence = $derived(
		shared
			? "This is the judges' shared room: starting over clears its plans and orders for everyone in it. The stage demo isn't touched."
			: "Clears your plans and orders in this demo; the shared demo isn't touched."
	);

	$effect(() => {
		if (!open) {
			confirming = false;
			note = null;
		}
	});

	async function startOver() {
		busy = true;
		note = null;
		try {
			const r = await fetch('/api/demo/sandbox/reset', { method: 'POST' });
			const b = (await r.json().catch(() => null)) as {
				retryInMs?: number;
				error?: { message?: string };
			} | null;
			if (r.ok) {
				// Every screen reads the fresh run from the start.
				location.reload();
				return;
			}
			note =
				r.status === 429
					? `It was just started over. Try again in ${Math.ceil((b?.retryInMs ?? 0) / 1000)} s.`
					: (b?.error?.message ?? 'Starting over did not work. Try again.');
		} catch {
			note = 'Starting over did not work: the server could not be reached.';
		} finally {
			busy = false;
		}
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-meta font-medium {on
			? 'border-ink bg-ink text-sheet'
			: 'border-rule-strong text-ink-2 hover:text-ink'}"
		aria-label="System{on ? ': the system layer is on' : ''}"
	>
		<Cpu size={13} aria-hidden="true" />
		<span class="hidden sm:inline">System</span>
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			sideOffset={6}
			align="end"
			class="z-50 w-[min(320px,calc(100vw-24px))] rounded-lg border border-rule bg-sheet p-3 text-meta text-ink-2 shadow-lg"
		>
			<label class="flex cursor-pointer items-start justify-between gap-3">
				<span>
					<span class="block text-body font-medium text-ink">Show how it works</span>
					Formulas, gates, hashes and op ids over the plain words.
				</span>
				<input
					type="checkbox"
					role="switch"
					class="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
					checked={on}
					onchange={ontoggle}
				/>
			</label>
			{#if kind !== 'stage'}
				<div class="mt-3 border-t border-rule pt-3">
					{#if !confirming}
						<button
							type="button"
							class="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-rule-strong text-body text-ink hover:bg-well"
							onclick={() => (confirming = true)}
						>
							<RotateCcw size={14} aria-hidden="true" /> Start over (reset my sandbox)
						</button>
					{:else}
						<p class="text-body text-ink">Start over?</p>
						<p class="mt-0.5">{consequence}</p>
						<div class="mt-2.5 flex gap-2">
							<button
								type="button"
								class="h-8 flex-1 rounded-md bg-ink px-3 text-body font-medium text-sheet disabled:opacity-50"
								disabled={busy}
								onclick={startOver}>{busy ? 'Starting over…' : 'Start over'}</button
							>
							<button
								type="button"
								class="h-8 rounded-md px-3 text-body text-ink-2 hover:bg-well hover:text-ink"
								onclick={() => (confirming = false)}>Cancel</button
							>
						</div>
					{/if}
					{#if note}<p class="mt-2 text-ink" role="status">{note}</p>{/if}
				</div>
			{/if}
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
