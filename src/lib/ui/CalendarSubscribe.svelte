<script lang="ts">
	/**
	 * "Add to calendar" for the kitchen on screen: decide-before times, deliveries, receiving days, Finnish holidays
	 * and festivities (core/calendar.ts). Three ways in, because a webcal: link does nothing on a machine without a
	 * calendar app: download the .ics (works everywhere, a snapshot), add it to Google Calendar (kept up to date),
	 * or copy the feed link for any other calendar. Subscribing needs a read-only calendar token for this browser's
	 * own sandbox (never a judge key); outside it (the stage, a shared room) only the download is offered.
	 */
	import { Popover } from 'bits-ui';
	import { CalendarPlus, Check, Copy, Download } from '@lucide/svelte';

	let { kitchenId }: { kitchenId: string } = $props();

	let link = $state<{ url: string; webcal: string } | null>(null);
	let copied = $state(false);
	let open = $state(false);

	$effect(() => {
		const id = kitchenId;
		link = null;
		let gone = false;
		void fetch(`/api/demo/calendar-link?kitchen=${encodeURIComponent(id)}`, { cache: 'no-store' })
			.then((r) => (r.ok ? r.json() : null))
			.then((j: { url?: string; webcal?: string } | null) => {
				if (!gone && j?.url && j.webcal) link = { url: j.url, webcal: j.webcal };
			})
			.catch(() => undefined);
		return () => (gone = true);
	});

	const download = $derived(`/kitchen-api/calendar.ics?kitchen=${encodeURIComponent(kitchenId)}`);
	const google = $derived(
		link ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(link.webcal)}` : null
	);

	async function copy() {
		if (!link) return;
		try {
			await navigator.clipboard.writeText(link.url);
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch {
			/* clipboard blocked: the link stays selectable below */
		}
	}

	const item =
		'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body text-ink hover:bg-well focus-visible:bg-well focus-visible:outline-none';
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="inline-flex shrink-0 items-center gap-1 text-meta whitespace-nowrap text-ink-2 hover:text-ink"
		title="Decide-before times, deliveries, holidays and festivities in your own calendar"
	>
		<CalendarPlus size={13} aria-hidden="true" />Add to calendar
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			sideOffset={6}
			align="end"
			class="z-50 w-[min(300px,calc(100vw-24px))] rounded-lg border border-rule bg-sheet p-2 shadow-lg"
		>
			<p class="px-2 pt-1 pb-2 text-meta text-ink-2">
				This kitchen's decide-before times, deliveries, receiving days, Finnish holidays and
				festivities.
			</p>
			<!-- A file and calendar apps' own URLs, not app routes. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a
				class={item}
				href={download}
				download="kitchen-calendar.ics"
				onclick={() => (open = false)}
			>
				<Download size={14} aria-hidden="true" />
				<span
					>Download .ics <span class="text-meta text-ink-3">· a snapshot, any calendar</span></span
				>
			</a>
			{#if google && link}
				<a
					class={item}
					href={google}
					target="_blank"
					rel="noopener noreferrer"
					onclick={() => (open = false)}
				>
					<CalendarPlus size={14} aria-hidden="true" />
					<span>Google Calendar <span class="text-meta text-ink-3">· stays up to date</span></span>
				</a>
				<button type="button" class={item} onclick={copy}>
					{#if copied}<Check size={14} aria-hidden="true" />Copied{:else}<Copy
							size={14}
							aria-hidden="true"
						/>Copy feed link <span class="text-meta text-ink-3">· Outlook, Apple, others</span>{/if}
				</button>
			{:else}
				<p class="px-2 pt-1 text-meta text-ink-3">
					Live subscription works in your own sandbox only.
				</p>
			{/if}
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
