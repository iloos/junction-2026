<script lang="ts">
	import { MonitorSmartphone } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Mandate · open on this device</title></svelte:head>

<main class="mx-auto max-w-md px-4 py-10 text-ink">
	<h1 class="flex items-center gap-2 text-xl font-semibold">
		<MonitorSmartphone size={20} aria-hidden="true" /> Open your kitchen on this device
	</h1>
	<p class="mt-2 text-ink-2">
		Type the code shown on your other device, under “Open this kitchen on another device”. A code
		works once, for 10 minutes.
	</p>
	{#if data.expired}
		<p class="mt-3 text-signoff">
			That link was used or has expired. Make a new one on the other device.
		</p>
	{/if}
	<form method="POST" use:enhance class="mt-5 flex gap-2">
		<label class="sr-only" for="code">Code</label>
		<input
			id="code"
			name="code"
			required
			autocomplete="one-time-code"
			autocapitalize="characters"
			spellcheck="false"
			maxlength="12"
			class="min-w-0 flex-1 rounded-md border border-rule-strong bg-paper px-3 py-2 font-mono text-lg tracking-widest uppercase"
			placeholder="ABC234"
		/>
		<button type="submit" class="rounded-md bg-accent px-4 text-sheet hover:bg-accent-ink"
			>Open</button
		>
	</form>
	{#if form?.message}<p class="mt-3 text-signoff" role="alert">{form.message}</p>{/if}
	<p class="mt-6 text-meta text-ink-3">
		Approving stays yours: this device opens your sandbox as you. An agent never gets this code.
	</p>
</main>
