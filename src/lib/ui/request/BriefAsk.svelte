<script lang="ts">
	import { CornerDownLeft } from '@lucide/svelte';
	import type { BriefAnswer, BriefQuestion } from './types';

	/** One event-brief question: chips to tap (several for a multi question) or a typed value. */
	interface Props {
		q: BriefQuestion;
		busy: boolean;
		onanswer: (a: BriefAnswer) => void;
	}
	let { q, busy, onanswer }: Props = $props();

	let typed = $state('');
	/** Chosen chips of a multi question, by label. */
	let chosen = $state.raw<string[]>([]);

	const isNone = (v: BriefAnswer['value'] | undefined) => Array.isArray(v) && v.length === 0;

	function tap(label: string, a: BriefAnswer) {
		if (!q.multi) return onanswer(a);
		// "None" stands alone; any other chip clears it.
		if (isNone(a.value)) chosen = [label];
		else if (chosen.includes(label)) chosen = chosen.filter((l) => l !== label);
		else
			chosen = [
				...chosen.filter((l) => !isNone(q.chips.find((c) => c.label === l)?.answer.value)),
				label
			];
	}

	function value(): BriefAnswer['value'] | null {
		const t = typed.trim();
		if (q.multi) {
			const fromChips = q.chips
				.filter((c) => chosen.includes(c.label))
				.flatMap((c) => c.answer.value as string[]);
			const fromText = t
				? t
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
				: [];
			return chosen.length || fromText.length ? [...fromChips, ...fromText] : null;
		}
		if (!t || !q.input) return null;
		if (q.input.kind === 'number') {
			const n = Number(t.replace(/\s/g, '').replace(',', '.'));
			return Number.isFinite(n) && n >= 0 ? n : null;
		}
		return t;
	}

	function send(e: SubmitEvent) {
		e.preventDefault();
		const v = value();
		if (v !== null) onanswer({ id: q.id, value: v });
	}
</script>

<div class="mt-3 border-t border-accent/25 pt-3" data-testid="brief-question">
	<p class="text-[14px] font-medium text-ink">{q.text}</p>
	<p class="text-[12.5px] text-ink-2">{q.why}</p>
	<ul class="mt-2 flex flex-wrap gap-1.5" aria-label="Answers">
		{#each q.chips as c (c.label)}
			<li>
				<button
					type="button"
					disabled={busy}
					aria-pressed={q.multi ? chosen.includes(c.label) : undefined}
					onclick={() => tap(c.label, c.answer)}
					class="num rounded-full border px-3 py-1 text-[13px] disabled:opacity-50 {q.multi &&
					chosen.includes(c.label)
						? 'border-accent bg-accent text-sheet'
						: 'border-rule-strong bg-sheet text-ink hover:border-accent/60'}">{c.label}</button
				>
			</li>
		{/each}
	</ul>
	{#if q.input || q.multi}
		<form class="mt-2 flex flex-wrap items-center gap-2" onsubmit={send}>
			{#if q.input}
				<label class="sr-only" for={q.id}>{q.input.placeholder}</label>
				<input
					id={q.id}
					bind:value={typed}
					type={q.input.kind === 'date' ? 'date' : 'text'}
					inputmode={q.input.kind === 'number' ? 'decimal' : undefined}
					placeholder={q.input.placeholder}
					class="h-9 w-52 rounded-md border border-rule-strong bg-sheet px-2 text-[14px]"
				/>
				{#if q.input.unit}<span class="text-[13px] text-ink-2">{q.input.unit}</span>{/if}
			{/if}
			<button
				type="submit"
				disabled={busy || value() === null}
				class="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-sheet disabled:opacity-40"
			>
				{q.multi ? 'Use these' : 'Use this'}
				<CornerDownLeft size={14} aria-hidden="true" />
			</button>
		</form>
	{/if}
</div>
