<script lang="ts">
	/**
	 * One decision: what (the exact lines), why (the reason in full), what declining costs, by when, and the terms
	 * it binds. A routine decision is Review → Confirm exact terms; a sign-off decision takes a deliberate hold.
	 * Approving one decision never approves another. Rendered by the kitchen panel, the phone sheet and the chat dock.
	 */
	import { tick } from 'svelte';
	import { ArrowRight, Clock3, Hand, ShieldAlert } from '@lucide/svelte';

	import HoldButton from './HoldButton.svelte';
	import type { Decision } from './decisions';
	import { money, num, shortHash, storyTime } from './format';

	interface Props {
		decision: Decision;
		/** Product names by id. */
		names: Map<string, string>;
		/** Fallback due time for decisions recorded before they carried their own (decisionsDue). */
		due?: string;
		busy?: boolean;
		/** Lines whose terms changed since the chef last saw them (highlighted). */
		changed?: Set<string>;
		/** Grant exactly these lines. Resolves true when the server accepted it. */
		onapprove?: (lineIds: string[]) => Promise<boolean>;
		/** Keep these lines held (deny this group). Omit where denying a subset is not possible. */
		onkeep?: (lineIds: string[]) => void;
		/** Read-only (chat dock, Ops): no actions, a link elsewhere does the approving. */
		readonly?: boolean;
		/** Title, amount and due time only (the chat's card; the full card is in the Kitchen). */
		compact?: boolean;
	}
	let {
		decision: d,
		names,
		due,
		busy = false,
		changed,
		onapprove,
		onkeep,
		readonly = false,
		compact = false
	}: Props = $props();
	/** One rule everywhere: the decision's own due time (decisionsDue over its lines). */
	const when = $derived(d.due ?? due);

	const SHOW = 4;
	let all = $state(false);
	let confirming = $state(false);
	let confirmBtn = $state<HTMLButtonElement | null>(null);
	const shown = $derived(all ? d.lines : d.lines.slice(0, SHOW));
	const n = $derived(d.lines.length);
	const noun = $derived(n === 1 ? 'line' : 'lines');

	async function review() {
		confirming = true;
		await tick();
		confirmBtn?.focus();
	}
	async function approve() {
		await onapprove?.(d.lineIds);
		confirming = false;
	}
</script>

<article
	class="rounded-lg bg-sheet px-3.5 py-3 {d.signOff
		? 'border-2 border-auth'
		: 'border border-auth/45'}"
	aria-label="Decision: {d.title ?? d.reason}"
	data-decision={d.key}
>
	<header class="flex items-start justify-between gap-3">
		<p class="flex min-w-0 items-start gap-1.5 text-body font-semibold text-ink">
			{#if d.signOff}<ShieldAlert
					size={16}
					class="mt-0.5 shrink-0 text-auth"
					aria-label="Needs sign-off"
				/>{:else}<Hand
					size={16}
					class="mt-0.5 shrink-0 text-auth"
					aria-label="Needs your approval"
				/>{/if}
			<span>{d.title ?? d.reason}</span>
		</p>
		<p class="mono shrink-0 text-body font-medium text-ink">{money(d.totalCents)}</p>
	</header>
	{#if compact}
		<p class="mt-0.5 text-meta text-ink-2">
			{d.reason} · {d.lineIds.length}
			{d.lineIds.length === 1 ? 'line' : 'lines'}
		</p>
	{:else}
		<p class="mt-1 text-meta text-ink-2">
			{#if d.title}<span class="font-medium text-ink">{d.reason}.</span>{/if}
			{d.why}
		</p>

		<ul class="mt-2 border-t border-rule pt-1.5">
			{#each shown as l (l.id)}
				<li
					class="flex items-baseline justify-between gap-3 py-0.5 text-meta {changed?.has(l.id)
						? 'bg-signoff-wash'
						: ''}"
				>
					<span class="min-w-0 truncate text-ink" title={names.get(l.productId) ?? l.productId}
						>{names.get(l.productId) ?? l.productId}</span
					>
					<span class="mono shrink-0 text-ink-2">{num(l.qty.value)} {l.qty.unit}</span>
				</li>
			{/each}
		</ul>
		{#if n > SHOW}
			<button
				type="button"
				class="text-meta text-ink-3 underline underline-offset-2 hover:text-ink"
				onclick={() => (all = !all)}>{all ? 'Show fewer' : `Show all ${n} lines`}</button
			>
		{/if}

		<p class="mt-2 text-meta text-ink-2">{d.consequence}</p>
	{/if}
	{#if when}
		<p class="mt-1 flex items-center gap-1.5 text-meta text-ink-2">
			<Clock3 size={13} aria-hidden="true" /> Decide before
			<span class="mono text-ink">{storyTime(when)}</span>
		</p>
	{/if}
	<p class="sys-only mono mt-1 text-micro text-ink-3">
		binds {d.approvalId} · plan v{d.planVersion} · terms {shortHash(d.termsHash)}
	</p>

	{#if !readonly}
		<div class="mt-3 space-y-1.5">
			{#if confirming}
				<p class="text-meta text-ink">
					Approve exactly these {n}
					{noun}, {money(d.totalCents)}? Other decisions stay open.
				</p>
				<div class="flex gap-2">
					<button
						bind:this={confirmBtn}
						type="button"
						class="h-10 flex-1 rounded-md bg-ink px-3 text-body font-medium text-sheet disabled:opacity-50"
						disabled={busy}
						onclick={approve}>Confirm exact terms</button
					>
					<button
						type="button"
						class="h-10 rounded-md border border-rule-strong px-3 text-body text-ink"
						onclick={() => (confirming = false)}>Cancel</button
					>
				</div>
			{:else if d.signOff}
				<HoldButton
					label="Hold to sign off {n} {noun}"
					disabled={busy}
					onconfirm={() => void approve()}
				/>
			{:else}
				<button
					type="button"
					class="flex h-10 w-full items-center justify-center gap-1.5 rounded-md border border-ink/70 text-body font-medium text-ink hover:bg-well disabled:opacity-50"
					disabled={busy}
					onclick={review}>Review {n} {noun} <ArrowRight size={14} aria-hidden="true" /></button
				>
			{/if}
			{#if onkeep && !confirming}
				<button
					type="button"
					class="h-8 w-full text-center text-meta text-ink-3 hover:text-ink"
					disabled={busy}
					onclick={() => onkeep(d.lineIds)}>Keep these held</button
				>
			{/if}
		</div>
	{/if}
</article>
