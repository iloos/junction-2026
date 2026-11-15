<script lang="ts">
	/**
	 * "Your ask so far": the agent's working memory of what the chef wants (the chat harness's update_draft), above the
	 * composer and updating each turn. One line per part; what is still open is marked so the chef sees what the next
	 * question is about. It changes nothing in the kitchen.
	 */
	import { ChevronDown, CircleDashed } from '@lucide/svelte';
	import { day, num } from '$lib/ui/format';
	import type { AskDraft, AskPart } from './types';

	let { ask }: { ask: AskDraft } = $props();
	let open = $state(true);

	const isoDay = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? day(d) : d);
	const amount = (p: AskPart) =>
		p.amount != null ? `${num(p.amount, p.amount % 1 ? 1 : 0)}${p.unit ? ` ${p.unit}` : ''}` : null;
	const STATUS: Record<NonNullable<AskPart['status']>, string> = {
		open: 'open',
		asking: 'asking you',
		fixed: 'set',
		checked: 'found',
		planned: 'planned',
		held: 'waits for you',
		ordered: 'ordered'
	};
	const isOpen = (p: AskPart) => !p.status || p.status === 'open' || p.status === 'asking';

	interface Row {
		label: string;
		text: string;
		open?: boolean;
	}
	const rows = $derived.by<Row[]>(() => {
		const out: Row[] = [];
		const what = [ask.occasion, isoDay(ask.date)].filter(Boolean).join(' · ');
		if (what) out.push({ label: 'For', text: what });
		if (ask.guests != null)
			out.push({
				label: 'Guests',
				text: `${num(ask.guests)}${ask.splits?.length ? ` (${ask.splits.map((s) => `${num(s.guests)} ${s.diet}`).join(', ')})` : ''}`
			});
		for (const d of ask.dishes ?? []) {
			const parts = d.ingredients ?? [];
			const gaps = parts.filter(isOpen).length;
			out.push({
				label: d.course ? d.course[0].toUpperCase() + d.course.slice(1) : 'Dish',
				text: [
					d.name,
					d.guests != null ? `${num(d.guests)} guests` : null,
					d.diet,
					parts.length ? `${parts.length} ingredients${gaps ? `, ${gaps} open` : ''}` : null
				]
					.filter(Boolean)
					.join(' · '),
				open: gaps > 0
			});
		}
		for (const p of ask.items ?? [])
			out.push({
				label: 'Item',
				text: [p.words, amount(p) ?? 'how much?', p.quality, p.status ? STATUS[p.status] : null]
					.filter(Boolean)
					.join(' · '),
				open: isOpen(p) || p.amount == null
			});
		if (ask.restrictions?.length) out.push({ label: 'Never', text: ask.restrictions.join(', ') });
		for (const o of ask.open ?? []) out.push({ label: 'Open', text: o, open: true });
		return out;
	});
	const openCount = $derived(rows.filter((r) => r.open).length);
</script>

{#if rows.length}
	<section class="shrink-0 border-t border-rule bg-paper px-3 py-2" aria-labelledby="ask-h">
		<button
			type="button"
			class="flex w-full items-center gap-2 text-left text-meta"
			aria-expanded={open}
			aria-controls="ask-rows"
			onclick={() => (open = !open)}
		>
			<span id="ask-h" class="font-medium text-ink">Your ask so far</span>
			<span class="text-ink-3"
				>{rows.length}
				{rows.length === 1 ? 'part' : 'parts'}{#if openCount}&nbsp;·
					<span class="text-signoff">{openCount} open</span>{/if}</span
			>
			<ChevronDown
				size={14}
				class="ml-auto text-ink-3 transition-transform {open ? 'rotate-180' : ''}"
				aria-hidden="true"
			/>
		</button>
		{#if open}
			<ul id="ask-rows" class="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-meta">
				{#each rows as r, i (i)}
					<li class="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
						<span class="text-ink-3">{r.label}</span>
						<span class="flex min-w-0 items-center gap-1 {r.open ? 'text-ink' : 'text-ink-2'}"
							>{#if r.open}<CircleDashed
									size={12}
									class="shrink-0 text-signoff"
									aria-label="open"
								/>{/if}<span class="truncate" title={r.text}>{r.text}</span></span
						>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}
