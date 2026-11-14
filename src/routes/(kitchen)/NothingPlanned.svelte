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
		onask
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
	} = $props();
</script>

<div class="flex flex-col gap-6">
	<div>
		<p class="text-meta text-ink-3">{kitchenName}</p>
		<h1 class="mt-1 text-title font-semibold tracking-[-0.015em] text-ink">
			{date ? `Nothing planned for ${day(date)}` : 'Nothing planned yet'}
		</h1>
		<p class="mt-1 max-w-[60ch] text-body text-ink-2">
			Pick a delivery day. Start from what this kitchen usually orders that day, or tell the agent
			what you need.
		</p>
	</div>

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

	<blockquote class="border-l-2 border-accent pl-3 text-meta text-ink-2">
		“{mandateWords}”
		<footer class="mt-0.5 text-micro text-ink-3">
			The chef's mandate: what the agent may do alone.
		</footer>
	</blockquote>
</div>
