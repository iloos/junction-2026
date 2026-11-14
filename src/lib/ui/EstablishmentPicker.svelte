<script lang="ts">
	/**
	 * The first screen in a fresh sandbox (D15): "Who are you cooking for?". One card per seeded kitchen (type,
	 * delivery rhythm, its top two preferences, its hard rules), or a sentence about your own kitchen that maps to the
	 * nearest one (/kitchen-api/establishment). The sentence stays as the kitchen's notes, editable; it changes no
	 * rule. `onchoose` fires once, with the notes only on the description path.
	 */
	import {
		ArrowRight,
		Flag,
		ListChecks,
		LoaderCircle,
		MilkOff,
		ShieldAlert,
		Wallet
	} from '@lucide/svelte';
	import type { Kitchen } from '$lib/core/contracts';
	import {
		establishmentCard,
		type EstablishmentMatch,
		type RuleKey
	} from '$lib/core/establishment';
	import { ALL_KITCHENS } from '$lib/kitchen/catalog';

	let {
		onchoose,
		kitchens = ALL_KITCHENS
	}: {
		onchoose: (kitchenId: string, notes?: string) => void;
		kitchens?: Kitchen[];
	} = $props();

	const cards = $derived(kitchens.map(establishmentCard));
	const ICONS: Record<RuleKey, typeof Flag> = {
		free_from: MilkOff,
		origin_required: Flag,
		origin_preferred: Flag,
		tender_list: ListChecks,
		unknown_allergens: ShieldAlert,
		cap: Wallet
	};

	let text = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let match = $state<Omit<EstablishmentMatch, 'source'> | null>(null);
	let notes = $state('');
	let chosen = $state(false);
	const matchedCard = $derived(match ? cards.find((c) => c.id === match!.kitchenId) : undefined);

	function choose(id: string, withNotes?: string) {
		if (chosen) return;
		chosen = true;
		onchoose(id, withNotes);
	}

	async function find(e: SubmitEvent) {
		e.preventDefault();
		const t = text.trim();
		if (t.length < 3 || busy) return;
		busy = true;
		error = null;
		try {
			const r = await fetch('/kitchen-api/establishment', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: t })
			});
			const j = await r.json();
			if (!r.ok) throw new Error(j?.error?.message ?? 'no match');
			match = j;
			notes = j.notes;
		} catch {
			error = "That didn't go through. Try again, or pick the closest kitchen above.";
		} finally {
			busy = false;
		}
	}
</script>

<section
	aria-label="Who are you cooking for"
	data-testid="establishment-picker"
	class="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10"
>
	<h1 class="text-display font-semibold text-ink">Who are you cooking for?</h1>
	<p class="mt-1 max-w-2xl text-body text-ink-2">
		Pick the kitchen closest to yours. Each comes with its own delivery days, preferences and the
		rules its agent keeps.
	</p>

	<ul class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each cards as c (c.id)}
			{@const on = match?.kitchenId === c.id}
			<li>
				<button
					type="button"
					data-kitchen-id={c.id}
					aria-labelledby="est-{c.id}-name"
					aria-describedby="est-{c.id}-desc"
					disabled={chosen}
					onclick={() => choose(c.id)}
					class={[
						'group flex h-full w-full flex-col gap-2 rounded-lg border bg-sheet p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60',
						on ? 'border-accent ring-1 ring-accent' : 'border-rule-strong hover:border-accent'
					]}
				>
					<span class="flex items-baseline justify-between gap-2">
						<span class="text-meta text-ink-3">{c.type} · {c.city}</span>
						<ArrowRight
							size={14}
							class="shrink-0 text-ink-3 group-hover:text-accent"
							aria-hidden="true"
						/>
					</span>
					<span id="est-{c.id}-name" class="text-heading font-semibold text-ink">{c.name}</span>
					<span id="est-{c.id}-desc" class="flex flex-col gap-2">
						<span class="text-meta text-ink-2">{c.rhythm}</span>
						<span class="text-meta text-ink-2">
							<span class="text-ink-3">Ranks by:</span>
							{c.prefers}
						</span>
						<span class="mt-auto flex flex-wrap gap-1.5 pt-1">
							{#each c.rules as r (r.label)}
								{@const Icon = ICONS[r.key]}
								<span
									class="inline-flex items-center gap-1 rounded-full border border-rule px-2 py-0.5 text-micro text-ink-2"
								>
									<Icon size={11} aria-hidden="true" />{r.label}
								</span>
							{/each}
						</span>
					</span>
				</button>
			</li>
		{/each}
	</ul>

	<div class="mt-8 max-w-2xl">
		<form onsubmit={find} class="flex flex-col gap-2">
			<label for="est-describe" class="text-heading font-semibold text-ink"
				>Describe your kitchen</label
			>
			<p class="text-meta text-ink-2">
				None quite like yours? Say it in a sentence; we'll start you from the nearest one.
			</p>
			<textarea
				id="est-describe"
				bind:value={text}
				rows="2"
				maxlength="2000"
				disabled={chosen}
				placeholder="e.g. A school kitchen in Vantaa, 600 meals a day, many allergies"
				class="w-full rounded-md border border-rule-strong bg-sheet px-3 py-2 text-body text-ink placeholder:text-ink-3"
			></textarea>
			<div class="flex items-center gap-3">
				<button
					type="submit"
					disabled={busy || chosen || text.trim().length < 3}
					class="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-body font-medium text-sheet disabled:opacity-40"
				>
					{#if busy}<LoaderCircle size={14} class="animate-spin" aria-hidden="true" />{/if}
					Find the nearest
				</button>
				{#if error}<p class="text-meta text-out" role="alert">{error}</p>{/if}
			</div>
		</form>

		{#if match && matchedCard}
			<div class="mt-4 rounded-lg border border-accent bg-sheet p-4" aria-live="polite">
				<p class="text-meta text-ink-3">{match.close ? 'Closest match' : 'Nearest we have'}</p>
				<p class="text-heading font-semibold text-ink">{matchedCard.name}</p>
				<p class="mt-1 text-body text-ink-2">{match.why}</p>
				<label for="est-notes" class="mt-3 block text-meta font-medium text-ink">Your notes</label>
				<textarea
					id="est-notes"
					bind:value={notes}
					rows="2"
					maxlength="500"
					disabled={chosen}
					class="mt-1 w-full rounded-md border border-rule-strong bg-sheet px-3 py-2 text-body text-ink"
				></textarea>
				<p class="mt-1 text-micro text-ink-3">
					The agent reads these notes. They don't change the kitchen's rules; only you can.
				</p>
				<div class="mt-3 flex flex-wrap gap-2">
					<button
						type="button"
						disabled={chosen}
						onclick={() => choose(matchedCard.id, notes.trim() || undefined)}
						class="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-body font-medium text-sheet disabled:opacity-50"
					>
						Start as {matchedCard.name}<ArrowRight size={14} aria-hidden="true" />
					</button>
					<button
						type="button"
						disabled={chosen}
						onclick={() => (match = null)}
						class="inline-flex h-9 items-center rounded-md border border-rule-strong px-3 text-body text-ink"
					>
						Not this one
					</button>
				</div>
			</div>
		{/if}
	</div>
</section>
