<script lang="ts">
	/**
	 * One decision: what (the exact lines), why (the reason in full), what declining costs, by when, and the terms
	 * it binds. A routine decision is Review → Confirm exact terms; a sign-off decision takes a deliberate hold.
	 * Approving one decision never approves another. Rendered by the kitchen panel, the phone sheet and the chat dock.
	 */
	import { tick } from 'svelte';
	import { ChevronDown, Clock3, Eye, Hand, ShieldAlert } from '@lucide/svelte';

	import HoldButton from './HoldButton.svelte';
	import BillLines from './BillLines.svelte';
	import type { Decision } from './decisions';
	import { money, shortHash, storyTime, qtyWords } from './format';

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
		/** No title row: the rail's accordion row already says it. */
		headless?: boolean;
		/** Show this decision's lines on the page (scrolled to, marked). */
		onsee?: () => void;
		/** The plan's delivery date: the product cards price for it. */
		deliverBy?: string;
		/** The scenario's now: past the decision's cut-off, approving is greyed out with the reason. */
		now?: Date | string | null;
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
		compact = false,
		headless = false,
		onsee,
		deliverBy,
		now
	}: Props = $props();
	/** One rule everywhere: the decision's own due time (decisionsDue over its lines). */
	const when = $derived(d.due ?? due);
	/** Why approving can't work now, known before the click; null when it can. */
	const blocked = $derived(
		when && now && new Date(now).getTime() > new Date(when).getTime()
			? `The order cut-off passed (${storyTime(when)}): this can't be ordered for this delivery any more.`
			: null
	);

	/** The lines whose terms changed since the chef saw them open the details by themselves. */
	const changedHere = $derived(d.lineIds.some((id) => changed?.has(id)));
	let opened = $state<boolean | null>(null);
	const details = $derived(opened ?? changedHere);
	/** One line of consequence; the reasons in full and the lines are behind Details. */
	const held = $derived.by(() => {
		const dishes = new Set(d.lines.map((l) => l.needId).filter(Boolean)).size;
		return `If you say no: ${n} ${noun} not ordered${dishes ? `, ${dishes} ${dishes === 1 ? 'dish loses' : 'dishes lose'} cover` : ''}.`;
	});
	let confirming = $state(false);
	let confirmBtn = $state<HTMLButtonElement | null>(null);
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
	<header class="flex items-start justify-between gap-3" class:hidden={headless}>
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
		<p class="mt-0.5 text-meta text-ink-2">
			{d.reason} · <span class="mono">{n}</span>
			{noun}
		</p>
		<p class="mt-1.5 text-meta text-ink">{held}</p>
		<button
			type="button"
			class="mt-1 inline-flex items-center gap-1 text-meta text-ink-2 hover:text-ink"
			aria-expanded={details}
			onclick={() => (opened = !details)}
			><ChevronDown
				size={13}
				class="transition-transform {details ? '' : '-rotate-90'}"
				aria-hidden="true"
			/>Details{changedHere ? ' · terms changed' : ''}</button
		>
		{#if details}
			<p class="mt-1 text-meta text-ink-2">{d.why}</p>
			<div class="mt-1.5 border-t border-rule pt-1.5">
				<BillLines
					max={changedHere ? d.lines.length : 3}
					label="The lines this approves"
					{deliverBy}
					rows={d.lines.map((l) => ({
						id: l.id,
						productId: l.productId,
						name: `${changed?.has(l.id) ? 'Changed: ' : ''}${names.get(l.productId) ?? l.productId}`,
						qty: qtyWords(l.qty),
						cents: l.lineCents ?? null
					}))}
				/>
			</div>
		{/if}
	{/if}
	{#if when}
		<p class="mt-1 flex items-center gap-1.5 text-meta text-ink-2">
			<!-- The day reads at a glance; the exact time is behind the hover (five-second rule). -->
			<Clock3 size={13} aria-hidden="true" /> Decide by
			<span class="text-ink" title={storyTime(when)}
				>{storyTime(when).replace(/,\s*\d{1,2}:\d{2}$/, '')}</span
			>
		</p>
	{/if}
	<p class="sys-only mono mt-1 text-micro text-ink-3">
		binds {d.approvalId} · plan v{d.planVersion} · terms {shortHash(d.termsHash)}
	</p>

	{#if !readonly}
		<!-- One choice: the primary action, then the quieter ways out (keep held, see the lines). -->
		{#if confirming}
			<p class="mt-3 text-meta text-ink">
				Approve exactly these {n}
				{noun}, {money(d.totalCents)}? Other decisions stay open.
			</p>
			<div class="mt-2 flex flex-wrap items-center gap-2">
				<button
					bind:this={confirmBtn}
					type="button"
					class="h-10 rounded-md bg-accent px-4 text-body font-medium text-sheet hover:bg-accent-ink disabled:opacity-50"
					disabled={busy}
					onclick={approve}>Confirm exact terms</button
				>
				<button
					type="button"
					class="h-10 rounded-md px-3 text-body text-ink-2 hover:bg-well hover:text-ink"
					onclick={() => (confirming = false)}>Cancel</button
				>
			</div>
		{:else}
			<div class="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2">
				{#if d.signOff}
					<div class="min-w-48 flex-1" title={blocked ?? undefined}>
						<HoldButton
							label="Hold to sign off {n} {noun}"
							disabled={busy || !!blocked}
							onconfirm={() => void approve()}
						/>
					</div>
				{:else}
					<button
						type="button"
						class="h-10 rounded-md bg-ink px-4 text-body font-medium text-sheet hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-50"
						disabled={busy || !!blocked}
						title={blocked ?? undefined}
						aria-describedby={blocked ? `blocked-${d.key}` : undefined}
						onclick={review}
						>Review {n} {noun} · <span class="mono">{money(d.totalCents)}</span></button
					>
				{/if}
				{#if onkeep}
					<button
						type="button"
						class="h-10 rounded-md px-3 text-meta text-ink-2 hover:bg-well hover:text-ink"
						disabled={busy}
						onclick={() => onkeep(d.lineIds)}>Keep held</button
					>
				{/if}
				{#if onsee}
					<button
						type="button"
						class="inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-meta text-ink-2 hover:bg-well hover:text-ink"
						onclick={onsee}><Eye size={14} aria-hidden="true" /> See the lines</button
					>
				{/if}
			</div>
			{#if blocked}
				<p id="blocked-{d.key}" class="mt-1.5 text-meta leading-snug text-ink-2">{blocked}</p>
			{/if}
		{/if}
	{/if}
</article>
