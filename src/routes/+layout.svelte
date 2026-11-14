<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	let { children } = $props();

	const NAV = [
		{ href: resolve('/'), label: 'Kitchen', match: (p: string) => p === '/' || p === '/offline' },
		{ href: resolve('/request'), label: 'Request', match: (p: string) => p.startsWith('/request') },
		{ href: resolve('/ops'), label: 'Operations', match: (p: string) => p.startsWith('/ops') }
	];
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

<nav aria-label="Surfaces" class="border-b border-rule bg-sheet">
	<ul class="mx-auto flex h-9 max-w-[1440px] items-stretch gap-1 px-4 text-[13px] md:px-6">
		{#each NAV as item (item.label)}
			{@const current = item.match(page.url.pathname)}
			<li class="flex">
				<a
					href={item.href}
					aria-current={current ? 'page' : undefined}
					class="flex items-center border-b-2 px-2 {current
						? 'border-accent font-medium text-ink'
						: 'border-transparent text-ink-2 hover:text-ink'}">{item.label}</a
				>
			</li>
		{/each}
	</ul>
</nav>
{@render children()}
