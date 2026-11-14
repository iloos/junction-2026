<script lang="ts">
	/**
	 * Where a fact came from, honestly (ExternalCallTrace.cache): live = a call just now; cache = an earlier live
	 * answer; replay = a recorded answer played back; fixture = test data. Same dot language everywhere: filled,
	 * hollow, dashed, struck. Optional link to the cited page (web evidence).
	 */
	import { ExternalLink } from '@lucide/svelte';
	import { storyTime } from './format';

	type Api = 'valio' | 'gemini' | 'exa' | 'contextdev' | 'featherless' | 'other';
	interface Props {
		api: Api;
		cache: 'live' | 'cache' | 'replay' | 'fixture';
		/** When the answer was fetched (scenario or wall clock, ISO). */
		at?: string;
		/** A cited page, for web evidence. */
		href?: string;
		/** Overrides the provider name, e.g. the cited site's domain. */
		label?: string;
	}
	let { api, cache, at, href, label }: Props = $props();

	const NAME: Record<Api, string> = {
		valio: 'Valio',
		gemini: 'Gemini',
		exa: 'Exa',
		contextdev: 'Context.dev',
		featherless: 'Gemma',
		other: 'Web'
	};
	const WORD = { live: 'live', cache: 'cached', replay: 'replayed', fixture: 'test data' } as const;
	const DOT = {
		live: 'bg-sup-confirmed',
		cache: 'border border-sup-confirmed',
		replay: 'border border-dashed border-ink-3',
		fixture:
			'border border-ink-3 bg-[linear-gradient(135deg,transparent_45%,var(--color-ink-3)_45%,var(--color-ink-3)_55%,transparent_55%)]'
	} as const;
	const title = $derived(
		`${label ?? NAME[api]}: ${WORD[cache]}${at ? `, ${storyTime(at)}` : ''}${href ? ` · ${href}` : ''}`
	);
</script>

{#snippet body()}
	<span class="size-2 shrink-0 rounded-full {DOT[cache]}" aria-hidden="true"></span>
	<span class="truncate">{label ?? NAME[api]}</span>
	<span class="text-ink-3">{WORD[cache]}</span>
	{#if href}<ExternalLink size={11} class="shrink-0" aria-hidden="true" />{/if}
{/snippet}

{#if href}
	<!-- An outside citation, not an app route. -->
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<a
		{href}
		target="_blank"
		rel="noopener noreferrer"
		{title}
		class="inline-flex h-5 max-w-full items-center gap-1 rounded-full border border-rule-strong px-1.5 text-micro text-ink-2 hover:text-ink"
		>{@render body()}</a
	>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
{:else}
	<span
		{title}
		class="inline-flex h-5 max-w-full items-center gap-1 rounded-full border border-rule-strong px-1.5 text-micro text-ink-2"
		>{@render body()}</span
	>
{/if}
