<script lang="ts">
	/**
	 * The first screen in a fresh sandbox (D15, D25): "Who are you cooking for?". It leads with your own kitchen (a
	 * name and an optional line about it → a new blank kitchen with default rules, no history, no booking, through
	 * create_kitchen). The seeded kitchens follow as sample profiles with simulated history. The same card makes your
	 * store in the shared room (D24).
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
	import { establishmentCard, type RuleKey } from '$lib/core/establishment';
	import { NotYet, createKitchen, type CreatedKitchen } from '$lib/kitchen/own';
	import { ALL_KITCHENS } from '$lib/kitchen/catalog';

	let {
		onchoose,
		oncreated,
		kitchens = ALL_KITCHENS
	}: {
		/** A sample kitchen was picked. */
		onchoose: (kitchenId: string, notes?: string) => void;
		/** Your own kitchen was made (and is in this workspace, ready to join). */
		oncreated?: (k: CreatedKitchen, description?: string) => void;
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

	let name = $state('');
	let about = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let chosen = $state(false);

	function choose(id: string) {
		if (chosen) return;
		chosen = true;
		onchoose(id);
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		const n = name.trim();
		if (!n || busy || chosen) return;
		busy = true;
		error = null;
		try {
			const d = about.trim() || undefined;
			const r = await createKitchen({ name: n, ...(d ? { description: d } : {}) });
			chosen = true;
			oncreated?.(r.kitchen, d);
		} catch (err) {
			error =
				err instanceof NotYet
					? 'Your own kitchen opens with the next update. Meanwhile, try a sample kitchen below.'
					: "That didn't go through. Try again, or try a sample kitchen below.";
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

	<form
		onsubmit={create}
		class="mt-4 flex max-w-2xl flex-col gap-3 rounded-lg border border-accent bg-sheet p-4"
		aria-labelledby="own-h"
	>
		<div>
			<h2 id="own-h" class="text-heading font-semibold text-ink">Your own kitchen</h2>
			<p class="mt-0.5 text-meta text-ink-2">
				Name it and start ordering. Your agent starts with safe default rules (it asks before new
				products and never changes an allergen) and learns your usual order as you go.
			</p>
		</div>
		<label class="flex flex-col gap-1 text-meta font-medium text-ink">
			Kitchen name
			<input
				bind:value={name}
				maxlength="60"
				required
				disabled={chosen}
				placeholder="e.g. Pasta Bar Kallio"
				class="h-10 rounded-md border border-rule-strong bg-sheet px-3 text-body font-normal text-ink placeholder:text-ink-3"
			/>
		</label>
		<label class="flex flex-col gap-1 text-meta font-medium text-ink">
			<span>About it <span class="font-normal text-ink-3">(optional, one line)</span></span>
			<input
				bind:value={about}
				maxlength="300"
				disabled={chosen}
				placeholder="e.g. 80 lunches a day, many gluten-free guests"
				class="h-10 rounded-md border border-rule-strong bg-sheet px-3 text-body font-normal text-ink placeholder:text-ink-3"
			/>
		</label>
		<div class="flex flex-wrap items-center gap-3">
			<button
				type="submit"
				disabled={busy || chosen || !name.trim()}
				class="inline-flex h-10 items-center gap-1.5 rounded-md bg-accent px-4 text-body font-medium text-sheet hover:bg-accent-ink disabled:opacity-40"
			>
				{#if busy}<LoaderCircle size={14} class="animate-spin" aria-hidden="true" />{/if}
				Start my kitchen<ArrowRight size={14} aria-hidden="true" />
			</button>
			{#if error}<p class="text-meta text-ink-2" role="alert">{error}</p>{/if}
		</div>
	</form>

	<h2 class="mt-10 text-heading font-semibold text-ink">Or try a sample kitchen</h2>
	<p class="mt-0.5 max-w-2xl text-meta text-ink-2">
		Sample profiles with simulated order history: each has its own delivery days, preferences and
		the rules its agent keeps.
	</p>

	<ul class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each cards as c (c.id)}
			<li>
				<button
					type="button"
					data-kitchen-id={c.id}
					aria-labelledby="est-{c.id}-name"
					aria-describedby="est-{c.id}-desc"
					disabled={chosen}
					onclick={() => choose(c.id)}
					class="group flex h-full w-full flex-col gap-2 rounded-lg border border-rule-strong bg-sheet p-4 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
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
</section>
