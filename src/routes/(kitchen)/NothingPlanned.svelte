<script lang="ts">
	/**
	 * A kitchen with nothing planned for the day in view: pick the delivery day, plan its usual order (U's
	 * UsualOrder, a suggestion until the chef plans it), or ask the agent for that day. Planning opens the new plan.
	 * Used before a kitchen's first plan and for an empty day in the Basket.
	 */
	import { Bot } from '@lucide/svelte';
	import DayPicker from '$lib/ui/DayPicker.svelte';
	import UsualOrder from '$lib/ui/UsualOrder.svelte';
	import { day } from '$lib/ui/format';

	let {
		kitchenId,
		kitchenName,
		mandateWords,
		date = $bindable(null),
		onplanned,
		onask,
		notes = null,
		onnotes,
		embedded = false
	}: {
		kitchenId: string;
		kitchenName: string;
		mandateWords: string;
		/** The delivery day in view (YYYY-MM-DD); null until picked (UsualOrder then uses the next receiving day). */
		date?: string | null;
		/** A plan was made from the usual order: the page opens it. */
		onplanned: (planId: string) => void;
		/** Open the agent, scoped to this day when one is picked. */
		onask: (date: string | null) => void;
		/** The chef's description from joining (D15): shown and editable; it changes no rule. */
		notes?: string | null;
		onnotes?: (notes: string) => void;
		/** Inside another screen (below a booked event): no title of its own, no mandate quote. */
		embedded?: boolean;
	} = $props();
	let editingNotes = $state(false);
	let draftNotes = $state('');
</script>

<div class="flex flex-col gap-6">
	{#if !embedded}<div>
			<p class="text-meta text-ink-3">{kitchenName}</p>
			<h1 class="mt-1 text-title font-semibold tracking-[-0.015em] text-ink">
				{date ? `Nothing planned for ${day(date)}` : 'Nothing planned yet'}
			</h1>
			<p class="mt-1 max-w-[60ch] text-body text-ink-2">
				Pick a delivery day. Start from what this kitchen usually orders that day, or tell the agent
				what you need.
			</p>
			{#if notes || onnotes}
				<div class="mt-3 max-w-[60ch] rounded-md bg-well/60 px-3 py-2 text-meta text-ink-2">
					{#if editingNotes}
						<label for="np-notes" class="font-medium text-ink">Your notes</label>
						<textarea
							id="np-notes"
							bind:value={draftNotes}
							rows="2"
							maxlength="500"
							class="mt-1 w-full rounded border border-rule-strong bg-sheet px-2 py-1 text-body text-ink"
						></textarea>
						<button
							type="button"
							class="mt-1 text-accent-ink underline underline-offset-2"
							onclick={() => {
								onnotes?.(draftNotes.trim());
								editingNotes = false;
							}}>Save</button
						>
					{:else if notes}
						<span class="font-medium text-ink">Your notes:</span>
						{notes}
						<button
							type="button"
							class="ml-1 text-accent-ink underline underline-offset-2"
							onclick={() => ((draftNotes = notes ?? ''), (editingNotes = true))}>Edit</button
						>
						<span class="block text-micro text-ink-3"
							>The agent's rules don't change with them.</span
						>
					{/if}
				</div>
			{/if}
		</div>{/if}

	<div class="grid gap-6 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:items-start">
		<div class="flex flex-col gap-3">
			<DayPicker {kitchenId} bind:value={date} label="Delivery day" />
			<button
				type="button"
				class="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-rule-strong bg-sheet px-4 text-body font-medium text-ink hover:border-accent"
				onclick={() => onask(date)}
			>
				<Bot size={16} aria-hidden="true" />
				{date ? `Ask the agent for ${day(date)}` : 'Ask the agent'}
			</button>
		</div>
		{#key `${kitchenId}|${date ?? ''}`}
			<UsualOrder {kitchenId} date={date ?? undefined} onplanned={(r) => onplanned(r.planId)} />
		{/key}
	</div>

	{#if !embedded}<blockquote class="border-l-2 border-accent pl-3 text-meta text-ink-2">
			“{mandateWords}”
			<footer class="mt-0.5 text-micro text-ink-3">
				The chef's mandate: what the agent may do alone.
			</footer>
		</blockquote>{/if}
</div>
