<script lang="ts">
	import EstablishmentPicker from '$lib/ui/EstablishmentPicker.svelte';

	let chosen = $state<{ id: string; notes?: string } | null>(null);
</script>

<EstablishmentPicker onchoose={(id, notes) => (chosen = { id, notes })} />
{#if chosen}
	<p class="mono mx-auto max-w-5xl px-4 pb-8 text-meta" data-testid="join-chosen">
		chosen: {chosen.id}{chosen.notes ? ` · notes: ${chosen.notes}` : ''}
	</p>
{/if}
