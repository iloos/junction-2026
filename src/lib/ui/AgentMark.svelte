<script lang="ts">
	/** "By the agent": the agent's work marked where it sits, in the same place as the chef's. */
	import { Bot } from '@lucide/svelte';
	let { by }: { by: 'kitchen_agent' | 'external_agent' } = $props();
</script>

<span
	class="inline-flex items-center gap-1 text-meta font-medium whitespace-nowrap text-propose"
	title={by === 'external_agent'
		? 'An outside agent (MCP) proposed this; a chef still decides.'
		: 'The kitchen agent proposed this; a chef still decides.'}
	><Bot size={12} aria-hidden="true" />{by === 'external_agent'
		? 'by an outside agent'
		: 'by the agent'}</span
>
