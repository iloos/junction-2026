<script lang="ts">
	/** The demo's plumbing (workspace, scenario run, simulated clock, start over), out of the chef's header. */
	import { Popover } from 'bits-ui';
	import { Clock, RotateCcw } from '@lucide/svelte';

	import type { SandboxInfo } from './shell.svelte';

	let { sandbox }: { sandbox: SandboxInfo } = $props();
	const shared = $derived(sandbox.workspace === 'ws-demo');
	let open = $state(false);
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="inline-flex h-7 items-center gap-1.5 rounded-full border border-rule-strong px-2.5 text-meta text-ink-2 hover:text-ink"
		aria-label="Sandbox: {sandbox.clock}, simulated clock"
	>
		<Clock size={13} aria-hidden="true" />
		<span class="mono hidden md:inline">{sandbox.clock}</span>
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			sideOffset={6}
			align="end"
			class="z-50 w-[min(300px,calc(100vw-24px))] rounded-lg border border-rule bg-sheet p-3 text-meta text-ink-2 shadow-lg"
		>
			<p class="text-body font-semibold text-ink">Sandbox</p>
			<p class="mt-0.5 mb-2.5">
				{shared
					? 'The shared demo sandbox.'
					: 'Your own copy of the demo: your edits and orders are visible only in this browser.'}
			</p>
			<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				<dt>Simulated clock</dt>
				<dd class="mono text-ink">{sandbox.clock}</dd>
				<dt>Workspace</dt>
				<dd class="mono truncate text-ink" title={sandbox.workspace}>{sandbox.workspace}</dd>
				<dt>Scenario run</dt>
				<dd class="mono truncate text-ink" title={sandbox.run}>{sandbox.run}</dd>
			</dl>
			<button
				type="button"
				class="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-rule-strong text-body text-ink hover:bg-well disabled:opacity-50"
				disabled={sandbox.busy}
				onclick={() => {
					sandbox.onReset();
					open = false;
				}}
			>
				<RotateCcw size={14} aria-hidden="true" />
				{shared ? 'Reset demo' : 'Start over'}
			</button>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
