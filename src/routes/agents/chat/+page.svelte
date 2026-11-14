<script lang="ts">
	import { resolve } from '$app/paths';
	import ChatDock from '$lib/ui/chat/ChatDock.svelte';

	let open = $state(true);
</script>

<svelte:head><title>Mandate · agent chat</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 py-8 text-ink sm:px-6 lg:mr-96">
	<p class="text-sm text-ink-3">Agent chat</p>
	<h1 class="mt-1 text-2xl font-semibold">Ask the purchasing agent</h1>
	<p class="mt-2 max-w-2xl text-ink-2">
		The chat runs the same agent as MCP and REST, as your kitchen's routine agent: it plans and
		orders within the mandate, asks when a detail is missing, and stops at anything that needs a
		chef. Approving stays in the <a class="text-accent-ink underline" href={resolve('/')}>Kitchen</a
		> screen; the chat links there and continues once you have decided.
	</p>
	<p class="mt-4 text-sm text-ink-3">
		Every step and number in the chat comes from the task's ledger: supplier confirmed only with a
		receipt, ordered only with an order.
	</p>
</main>

<ChatDock bind:open />
