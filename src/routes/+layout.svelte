<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { replaceState } from '$app/navigation';

	import LabelPill from '$lib/ui/shell/LabelPill.svelte';
	import SandboxMenu from '$lib/ui/shell/SandboxMenu.svelte';
	import SystemToggle from '$lib/ui/shell/SystemToggle.svelte';
	import { provideShell } from '$lib/ui/shell/shell.svelte';
	import ChatDock from '$lib/ui/chat/ChatDock.svelte';
	import ServiceStatus from './ops/ServiceStatus.svelte';
	import { Bot } from '@lucide/svelte';

	let { children } = $props();

	const NAV = [
		{
			href: resolve('/'),
			label: 'Kitchen',
			short: undefined as string | undefined,
			match: (p: string) => p === '/' || p === '/offline'
		},
		{ href: resolve('/request'), label: 'Request', match: (p: string) => p.startsWith('/request') },
		{
			href: resolve('/ops'),
			label: 'Operations',
			short: 'Ops',
			match: (p: string) => p.startsWith('/ops')
		},
		{
			href: resolve('/agents'),
			label: 'Agent API',
			short: 'API',
			match: (p: string) => p.startsWith('/agents')
		}
	];

	const shell = provideShell();
	// A link with ?system=1 turns the System layer on; navigating without it keeps the visitor's choice.
	$effect.pre(() => {
		if (page.url.searchParams.get('system') === '1') shell.system = true;
		if (page.url.searchParams.get('chat') === '1') shell.chatOpen = true;
	});

	/** Ops is read on a wall screen: the same tokens, dark. */
	const theme = $derived(page.url.pathname.startsWith('/ops') ? 'dark' : undefined);

	$effect(() => shell.loadRailWidth());
	$effect(() => {
		const html = document.documentElement;
		if (shell.system) html.dataset.system = '';
		else delete html.dataset.system;
		if (theme) html.dataset.theme = theme;
		else delete html.dataset.theme;
	});

	function toggleSystem() {
		shell.system = !shell.system;
		const url = new URL(page.url);
		if (shell.system) url.searchParams.set('system', '1');
		else url.searchParams.delete('system');
		// Same page, only the query changes: the path is already resolved.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(url, page.state);
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
	/>
</svelte:head>

<header data-theme={theme} class="border-b border-rule bg-sheet text-ink">
	<div class="mx-auto flex h-11 max-w-[1440px] items-center gap-2 px-3 sm:gap-4 md:px-6">
		<a
			href={resolve('/')}
			class="flex shrink-0 items-center gap-2 text-heading font-semibold tracking-[-0.01em]"
			aria-label="Mandate home"
		>
			<!-- The three tiers spell M: teal posts act, the blue bar proposes, the amber dot is the chef's sign-off. -->
			<svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
				<rect width="32" height="32" rx="7" fill="#161b21" />
				<rect x="6.5" y="7" width="5" height="18" rx="2.5" fill="#1d9999" />
				<rect x="13.5" y="7" width="5" height="11" rx="2.5" fill="#4c88d3" />
				<rect x="20.5" y="7" width="5" height="18" rx="2.5" fill="#1d9999" />
				<circle cx="16" cy="23" r="2.5" fill="#e5a14b" />
			</svg>
			<span class="hidden md:inline">Mandate</span>
		</a>
		<nav aria-label="Surfaces" class="min-w-0">
			<ul class="flex h-11 items-stretch text-body">
				{#each NAV as item (item.label)}
					{@const current = item.match(page.url.pathname)}
					<li class="flex">
						<a
							href={item.href}
							aria-current={current ? 'page' : undefined}
							class="flex items-center border-b-2 px-1.5 sm:px-2 {current
								? 'border-accent font-medium text-ink'
								: 'border-transparent text-ink-2 hover:text-ink'}"
							>{#if item.short}<span class="sm:hidden">{item.short}</span><span
									class="hidden sm:inline">{item.label}</span
								>{:else}{item.label}{/if}</a
						>
					</li>
				{/each}
			</ul>
		</nav>
		<div class="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
			<LabelPill labels={shell.labels} />
			{#if shell.sandbox}<SandboxMenu sandbox={shell.sandbox} />{/if}
			<SystemToggle on={shell.system} ontoggle={toggleSystem} />
			<button
				type="button"
				class="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-meta font-medium {shell.chatOpen
					? 'bg-ink text-sheet'
					: 'bg-accent text-sheet hover:bg-accent-ink'}"
				aria-pressed={shell.chatOpen}
				aria-label="Ask the agent"
				onclick={() => (shell.chatOpen = !shell.chatOpen)}
			>
				<Bot size={14} aria-hidden="true" />
				<span class="hidden sm:inline">Agent</span>
			</button>
		</div>
	</div>
</header>
{#if shell.system && !page.url.pathname.startsWith('/ops')}
	<!-- System layer: where each outside service's answers come from right now (Ops shows it in its own header). -->
	<div
		class="service-line border-b border-rule bg-well px-3 py-1.5 md:px-6"
		data-theme={theme}
		aria-label="Service status"
	>
		<div class="mx-auto max-w-[1440px]"><ServiceStatus /></div>
	</div>
{/if}
<!-- The agent rail pushes the page aside on desktop instead of covering it; its width is --rail-w. -->
<div class={shell.chatOpen ? 'lg:pr-[var(--rail-w)]' : ''} style="--rail-w: {shell.railWidth}px">
	{@render children()}
</div>

<!-- The purchasing agent on every page, scoped to what the page shows (shell.chat); it never approves. -->
<ChatDock
	kitchenId={shell.chat.kitchenId ?? 'k-hotel'}
	planId={shell.chat.planId}
	pinned={false}
	launcher={false}
	notice={(page.data as { room?: { notice?: string | null } }).room?.notice ?? null}
	bind:open={shell.chatOpen}
/>

<style>
	/* ServiceStatus speaks the Ops palette; outside Ops it reads the shared tokens. */
	.service-line {
		--text: var(--color-ink);
		--muted: var(--color-ink-2);
		--faint: var(--color-ink-3);
		--done: var(--color-ok);
		--sign-off: var(--color-signoff);
		--blocked: var(--color-out);
	}
</style>
