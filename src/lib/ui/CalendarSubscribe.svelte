<script lang="ts">
	/**
	 * "Add to calendar". First, for the plan on screen: its own dates as events the chef adds (decide-by with an alarm
	 * 2 h before, and the delivery day), as one .ics or Google's add-event form for the deadline. Second, and
	 * labelled as adding a whole calendar: the kitchen's subscription feed (every decide-by, delivery, holiday and
	 * festivity, kept up to date). The feed needs a read-only calendar token for this browser's own sandbox (never a
	 * judge key); outside it (the stage, a shared room) only the one-off downloads are offered.
	 */
	import { Popover } from 'bits-ui';
	import { BellRing, CalendarPlus, Check, Copy, Download, Rss } from '@lucide/svelte';
	import { day, storyTime } from './format';

	let { kitchenId, planId = null }: { kitchenId: string; planId?: string | null } = $props();

	let open = $state(false);
	let subscribe = $state(false);
	let copied = $state(false);
	let link = $state<{ url: string; webcal: string } | null>(null);
	let dates = $state<{
		decide: { due: string; count: number } | null;
		deliverBy: string;
		decideTitle: string;
		deliveryTitle: string;
		google: string | null;
	} | null>(null);

	// The plan's dates, read when the menu opens (they change as decisions are made).
	$effect(() => {
		if (!open || !planId) return;
		const id = planId;
		let gone = false;
		void fetch(`/kitchen-api/plan-dates?plan=${encodeURIComponent(id)}`, { cache: 'no-store' })
			.then((r) => (r.ok ? r.json() : null))
			.then((j) => {
				if (!gone) dates = j;
			})
			.catch(() => undefined);
		return () => (gone = true);
	});

	// The feed link, only once someone asks to subscribe.
	$effect(() => {
		if (!subscribe) return;
		const id = kitchenId;
		let gone = false;
		void fetch(`/api/demo/calendar-link?kitchen=${encodeURIComponent(id)}`, { cache: 'no-store' })
			.then((r) => (r.ok ? r.json() : null))
			.then((j: { url?: string; webcal?: string } | null) => {
				if (!gone) link = j?.url && j.webcal ? { url: j.url, webcal: j.webcal } : null;
			})
			.catch(() => undefined);
		return () => (gone = true);
	});

	$effect(() => {
		if (!open) subscribe = false;
	});

	const planIcs = $derived(
		planId ? `/kitchen-api/plan-dates?plan=${encodeURIComponent(planId)}&format=ics` : null
	);
	const feedIcs = $derived(`/kitchen-api/calendar.ics?kitchen=${encodeURIComponent(kitchenId)}`);
	const googleFeed = $derived(
		link ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(link.webcal)}` : null
	);

	async function copy() {
		if (!link) return;
		try {
			await navigator.clipboard.writeText(link.url);
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch {
			/* clipboard blocked: the download still works */
		}
	}

	const item =
		'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-body text-ink hover:bg-well focus-visible:bg-well focus-visible:outline-none';
	const sub = 'block text-meta text-ink-3';
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="inline-flex shrink-0 items-center gap-1 text-meta whitespace-nowrap text-ink-2 hover:text-ink"
		title={planId
			? "Add this plan's decide-by and delivery to your calendar"
			: 'Kitchen dates in your calendar'}
	>
		<CalendarPlus size={13} aria-hidden="true" />Add to calendar
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			sideOffset={6}
			align="end"
			class="z-50 w-[min(320px,calc(100vw-24px))] rounded-lg border border-rule bg-sheet p-2 shadow-lg"
		>
			<!-- Files and calendar apps' own URLs, not app routes. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			{#if planId && planIcs}
				<p class="px-2 pt-1 pb-1.5 text-meta font-medium text-ink">This plan's dates</p>
				{#if dates}
					<ul class="mb-1.5 px-2 text-meta text-ink-2">
						{#if dates.decide}
							<li class="flex items-start gap-1.5">
								<BellRing size={12} class="mt-0.5 shrink-0" aria-hidden="true" />
								<span
									>Decide by {storyTime(dates.decide.due)} ({dates.decide.count} decision{dates
										.decide.count === 1
										? ''
										: 's'}), reminder 2 h before</span
								>
							</li>
						{/if}
						<li class="flex items-start gap-1.5">
							<CalendarPlus size={12} class="mt-0.5 shrink-0" aria-hidden="true" />
							<span>Delivery {day(dates.deliverBy)}</span>
						</li>
					</ul>
				{/if}
				<a class={item} href={planIcs} download="plan-dates.ics" onclick={() => (open = false)}>
					<Download size={14} class="mt-0.5 shrink-0" aria-hidden="true" />
					<span
						>Add these events<span class={sub}>.ics for Outlook, Apple and any calendar</span></span
					>
				</a>
				{#if dates?.google}
					<a
						class={item}
						href={dates.google}
						target="_blank"
						rel="noopener noreferrer"
						onclick={() => (open = false)}
					>
						<CalendarPlus size={14} class="mt-0.5 shrink-0" aria-hidden="true" />
						<span>Google Calendar<span class={sub}>the decide-by, in Google's own form</span></span>
					</a>
				{/if}
				<hr class="my-1.5 border-rule" />
			{/if}

			{#if !subscribe}
				<button type="button" class={item} onclick={() => (subscribe = true)}>
					<Rss size={14} class="mt-0.5 shrink-0" aria-hidden="true" />
					<span
						>Subscribe to all kitchen dates…<span class={sub}
							>Adds a calendar: every decide-by, delivery, holiday and festivity, kept up to date</span
						></span
					>
				</button>
			{:else}
				<p class="px-2 pt-1 pb-1 text-meta text-ink-2">
					Adds a separate calendar that keeps this kitchen's decide-by times, deliveries, holidays
					and festivities up to date.
				</p>
				{#if googleFeed && link}
					<a
						class={item}
						href={googleFeed}
						target="_blank"
						rel="noopener noreferrer"
						onclick={() => (open = false)}
					>
						<Rss size={14} class="mt-0.5 shrink-0" aria-hidden="true" />
						<span>Subscribe in Google Calendar</span>
					</a>
					<button type="button" class={item} onclick={copy}>
						{#if copied}<Check
								size={14}
								class="mt-0.5 shrink-0"
								aria-hidden="true"
							/>Copied{:else}<Copy size={14} class="mt-0.5 shrink-0" aria-hidden="true" /><span
								>Copy the feed link<span class={sub}>Outlook, Apple: add a calendar from a URL</span
								></span
							>{/if}
					</button>
				{:else}
					<p class="px-2 pb-1 text-meta text-ink-3">
						A live subscription works in your own sandbox only. A snapshot still works:
					</p>
				{/if}
				<a
					class={item}
					href={feedIcs}
					download="kitchen-calendar.ics"
					onclick={() => (open = false)}
				>
					<Download size={14} class="mt-0.5 shrink-0" aria-hidden="true" />
					<span>Download all as a snapshot<span class={sub}>.ics, not kept up to date</span></span>
				</a>
			{/if}
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
