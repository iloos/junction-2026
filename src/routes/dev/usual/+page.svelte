<script lang="ts">
	import UsualOrder from '$lib/ui/UsualOrder.svelte';
	let { data } = $props();
</script>

<main class="mx-auto max-w-3xl p-4">
	<UsualOrder kitchenId={data.kitchen} date={data.date} />
</main>
