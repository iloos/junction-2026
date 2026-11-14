<script lang="ts">
	/**
	 * "Subscribe in your calendar" for the kitchen on screen: decide-before times, delivery and receiving days,
	 * Finnish holidays. The link carries a read-only calendar token for this browser's own sandbox (never a judge
	 * key); outside it (the stage, a shared room) the server says 409 and nothing is shown.
	 */
	import { CalendarPlus, Check, Copy } from '@lucide/svelte';

	let { kitchenId }: { kitchenId: string } = $props();

	let link = $state<{ url: string; webcal: string } | null>(null);
	let copied = $state(false);

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

	async function copy() {
		if (!link) return;
		try {
			await navigator.clipboard.writeText(link.url);
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch {
			/* clipboard blocked: the subscribe link still works */
		}
	}
</script>

{#if link}
	<span class="inline-flex shrink-0 items-center gap-2 text-meta">
		<!-- A calendar app's subscribe link, not an app route. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			href={link.webcal}
			class="inline-flex items-center gap-1 font-medium text-accent-ink hover:underline"
			title="Decide-before times, delivery days and Finnish holidays, kept up to date in your calendar"
			><CalendarPlus size={14} aria-hidden="true" />Subscribe in your calendar</a
		>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
		<button
			type="button"
			class="inline-flex items-center gap-1 text-ink-2 hover:text-ink"
			title="For Google Calendar: Other calendars → From URL"
			onclick={copy}
			>{#if copied}<Check size={13} aria-hidden="true" />Copied{:else}<Copy
					size={13}
					aria-hidden="true"
				/>Copy link{/if}</button
		>
	</span>
{/if}
