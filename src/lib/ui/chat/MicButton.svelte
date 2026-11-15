<script lang="ts">
	/**
	 * Dictate into the chat input (chat-harness §1c): press, speak Finnish or English, see the words land in the box as
	 * you speak, press again to stop. The chef reads, edits and sends; voice never sends on its own. Hidden when the
	 * server has no speech key or the browser can't record.
	 */
	import { onMount } from 'svelte';
	import { LoaderCircle, Mic, Square } from '@lucide/svelte';
	import { startDictation, voiceAvailable, type Dictation } from './voice';

	let {
		text,
		onchange,
		disabled = false
	}: {
		/** The input's text now: dictation appends to it. */
		text: () => string;
		onchange: (text: string) => void;
		disabled?: boolean;
	} = $props();

	let available = $state(false);
	let phase = $state<'idle' | 'starting' | 'listening' | 'stopping'>('idle');
	let error = $state<string | null>(null);
	let session: Dictation | null = null;

	onMount(() => {
		void voiceAvailable().then((v) => (available = v));
		return () => session?.stop();
	});

	/** Stop listening (Send calls this so the words heard so far are in the box). */
	export function stop() {
		if (phase === 'listening' || phase === 'starting') {
			phase = 'stopping';
			session?.stop();
		}
	}

	async function toggle() {
		if (phase !== 'idle') return stop();
		error = null;
		phase = 'starting';
		const before = text().trimEnd();
		const join = (s: string) =>
			before && s ? `${before} ${s.trimStart()}` : before || s.trimStart();
		try {
			session = await startDictation({
				ontext: (final, partial) => {
					if (phase === 'starting') phase = 'listening';
					onchange(join(final + partial));
				},
				ondone: (err) => {
					phase = 'idle';
					session = null;
					if (err) error = err;
				}
			});
			if (phase === 'starting') phase = 'listening';
		} catch (e) {
			phase = 'idle';
			error = (e as Error).message;
			if (/blocked/.test(error)) available = false;
		}
	}
</script>

{#if available || error}
	<span class="relative flex shrink-0 items-end">
		{#if available}
			<button
				type="button"
				class="inline-grid size-9 place-items-center rounded-md border disabled:opacity-40 {phase ===
					'listening' || phase === 'stopping'
					? 'border-out bg-out-wash text-out'
					: 'border-rule-strong text-ink-2 hover:border-accent hover:text-ink'}"
				disabled={disabled && phase === 'idle'}
				aria-pressed={phase === 'listening'}
				aria-label={phase === 'idle' ? 'Dictate (Finnish or English)' : 'Stop dictation'}
				title={phase === 'idle' ? 'Dictate: Finnish or English' : 'Stop dictation'}
				onclick={toggle}
			>
				{#if phase === 'starting'}
					<LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
				{:else if phase === 'idle'}
					<Mic size={16} aria-hidden="true" />
				{:else}
					<span class="relative grid place-items-center">
						<span class="absolute size-6 animate-ping rounded-full bg-out/30" aria-hidden="true"
						></span>
						<Square size={13} fill="currentColor" aria-hidden="true" />
					</span>
				{/if}
			</button>
		{/if}
		{#if phase === 'listening'}
			<span class="sr-only" role="status">Listening</span>
		{/if}
		{#if error}
			<span
				class="absolute right-0 bottom-full mb-1 w-56 rounded-md border border-rule bg-sheet px-2 py-1 text-micro text-ink-2 shadow-md"
				role="status"
				>{error}<button type="button" class="ml-1 underline" onclick={() => (error = null)}
					>OK</button
				></span
			>
		{/if}
	</span>
{/if}
