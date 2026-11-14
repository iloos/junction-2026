<script module lang="ts">
	/** One reason the order still won't cover something, with its items and, when it is one tap, the lines to approve. */
	export interface Shortfall {
		kind: 'unstated' | 'uncovered';
		sentence: string;
		items: { id: string; name: string; qty: string }[];
		approve?: string[];
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import { ChevronDown, CircleCheck, ShieldAlert, TriangleAlert, Hand } from '@lucide/svelte';
	import type { Approval, Line, Plan } from '$lib/core/contracts';
	import type { CommitNote, TermChange } from '$lib/kitchen/kitchen.svelte';
	import type { CommitRecord } from '$lib/kitchen/fixture-server';
	import DecisionCard from '$lib/ui/DecisionCard.svelte';
	import BillLines, { BILL_COLS, type BillRow } from '$lib/ui/BillLines.svelte';
	import Receipt from '$lib/ui/Receipt.svelte';
	import { decisionsDue, decisionsOf } from '$lib/ui/decisions';
	import { money, num, shortHash, day, storyTime, unitWord, qtyWords } from '$lib/ui/format';

	interface Props {
		plan: Plan;
		approval: Approval | null;
		lastInvalidated: Approval | null;
		/** Lines whose terms differ from the voided approval the chef saw. */
		changes: TermChange[];
		/** What the order still does not cover, in plain words. */
		shortfalls: Shortfall[];
		orders: CommitRecord[];
		lastCommit: CommitNote | null;
		names: Map<string, string>;
		busy: boolean;
		/** Decide one reason group (its line ids) of the pending approval. */
		onapprove: (lineIds?: string[]) => Promise<boolean>;
		ondeny: (lineIds?: string[]) => void;
		oncommit: () => void;
		onretry: () => void;
		/** Decide: the decisions. Order: totals, what is still not covered, place order, receipt. */
		part: 'decide' | 'order';
		/**
		 * The agent rail's form: one line per decision, opened one at a time in place, so the conversation keeps the
		 * room. The full cards stay on the page when the agent is closed.
		 */
		rail?: boolean;
		/** The chef is typing or a turn is running: the rail shows only its summary line. */
		folded?: boolean;
		/** Mark these lines on the page (null clears); `scroll` brings the first into view. */
		onmark?: (lineIds: string[] | null, scroll: boolean) => void;
	}
	let {
		plan,
		approval,
		lastInvalidated,
		changes,
		shortfalls,
		orders,
		lastCommit,
		names,
		busy,
		onapprove,
		ondeny,
		oncommit,
		onretry,
		part,
		rail = false,
		folded = false,
		onmark
	}: Props = $props();

	const byId = $derived(new Map(plan.lines.map((l) => [l.id, l])));
	const approvalLines = $derived(
		(approval?.lineIds ?? []).map((id) => byId.get(id)).filter((l): l is Line => !!l)
	);
	/** Every line a human approved on this plan, across decisions (approved one at a time or together). */
	const approvedN = $derived(
		plan.lines.filter(
			(l) =>
				l.tier !== undefined &&
				l.tier !== 'act' &&
				(l.state === 'committed' || l.view?.committable === true)
		).length
	);
	const approvalCents = $derived(approvalLines.reduce((s, l) => s + (l.lineCents ?? 0), 0));
	// Committable comes from the server's read model only (the offline stand-in builds it with core's lineView).
	const eligible = $derived(plan.lines.filter((l) => l.view?.committable === true));
	const eligibleCents = $derived(eligible.reduce((s, l) => s + (l.lineCents ?? 0), 0));

	const committedN = $derived(plan.lines.filter((l) => l.state === 'committed').length);
	const pending = $derived(approval?.state === 'pending');
	/** The approval's lines have been bought: show the ordered state, not "approved, not yet ordered". */
	const ordered = $derived(
		approvalLines.length > 0 && approvalLines.every((l) => l.state === 'committed')
	);
	const granted = $derived(approval?.state === 'granted');
	const showVoid = $derived(
		// Only an approval someone actually gave can "no longer apply"; a voided pending one was never approved.
		lastInvalidated &&
			lastInvalidated.decidedBy &&
			pending &&
			!lastInvalidated.reason?.includes('committed')
	);
	const changedIds = $derived(new Set(changes.map((c) => c.lineId)));
	/** One decision per reason group (lib/ui/decisions): the same count the task header and phone bar show. */
	const decisions = $derived(decisionsOf(plan, approval));
	const due = $derived(decisionsDue(plan, approval));
	/**
	 * After deciding: every line a human approved (ordered or not yet), grouped by why it needed them. Read from
	 * the lines, not the latest approval, so groups approved one at a time all show.
	 */
	const decided = $derived.by(() => {
		if (!approval || pending) return [] as ReturnType<typeof decisionsOf>;
		const ids = plan.lines
			.filter(
				(l) =>
					l.tier !== undefined &&
					l.tier !== 'act' &&
					(l.state === 'committed' || l.view?.committable === true)
			)
			.map((l) => l.id);
		return decisionsOf(plan, { ...approval, lineIds: ids, state: 'pending' });
	});
	/**
	 * Lines a human already approved in an earlier group decision and that are not ordered yet: committable but not
	 * within the mandate. Read from the line's view.
	 */
	const approvedEarlier = $derived(
		plan.lines.filter(
			(l) =>
				!approvalLines.includes(l) &&
				l.state !== 'committed' &&
				l.tier !== undefined &&
				l.tier !== 'act' &&
				l.view?.committable === true
		)
	);

	let commitBtn = $state<HTMLButtonElement | null>(null);
	async function approve(lineIds: string[]) {
		const was = decisions.find((d) => d.lineIds.join() === lineIds.join());
		const ok = await onapprove(lineIds);
		await tick();
		if (ok && was) {
			result = `Approved ${was.title ?? was.reason} · ${was.lineIds.length} ${was.lineIds.length === 1 ? 'line' : 'lines'} · ${money(was.totalCents)}`;
			if (openKey === was.key) openKey = null;
		}
		if (ok && decisions.length === 0) commitBtn?.focus();
		return ok;
	}

	/** Rail: the one open decision, the one under the pointer or focus, and the last thing approved here. */
	let openKey = $state<string | null>(null);
	let hoverKey = $state<string | null>(null);
	let result = $state<string | null>(null);
	/** The deadline in one short phrase: "Tue 15:00". */
	const shortDue = $derived(due ? storyTime(due).replace(/\s\d{1,2}\s\w{3},/, '') : null);
	// What the chef is looking at in the rail is marked on the page; nothing open or hovered clears it.
	$effect(() => {
		if (!rail || !onmark) return;
		const key = hoverKey ?? openKey;
		const d = key ? decisions.find((x) => x.key === key) : null;
		onmark(d ? d.lineIds : null, false);
	});
	$effect(() => {
		if (!rail || !onmark) return;
		return () => onmark(null, false);
	});
	/** On the page (no rail to hold it open), "See the lines" marks them for a few seconds. */
	let seeTimer: ReturnType<typeof setTimeout> | undefined;
	function seeBriefly(ids: string[]) {
		onmark?.(ids, true);
		clearTimeout(seeTimer);
		seeTimer = setTimeout(() => onmark?.(null, false), 4000);
	}
	function toggle(key: string) {
		openKey = openKey === key ? null : key;
		result = null;
		const d = openKey ? decisions.find((x) => x.key === openKey) : null;
		if (d) onmark?.(d.lineIds, true);
	}
	const nameOf = (id: string) => names.get(id) ?? id;
	const billOf = (lines: Line[]): BillRow[] =>
		lines.map((l) => ({
			id: l.id,
			name: nameOf(l.productId),
			qty: qtyWords(l.qty),
			cents: l.lineCents ?? null
		}));
	const centsOf = (lines: Line[]) => lines.reduce((s, l) => s + (l.lineCents ?? 0), 0);

	/**
	 * The plan's money as a partition that adds up: every priced, orderable line sits in exactly one row, by what
	 * happened to it (ordered, awaiting a decision, approved, within the mandate, held for another reason).
	 */
	const split = $derived.by(() => {
		const pendingIds = new Set(pending ? (approval?.lineIds ?? []) : []);
		const sums = { ordered: 0, decide: 0, approved: 0, within: 0, held: 0 };
		for (const l of plan.lines) {
			if (l.state === 'rejected' || l.state === 'unorderable') continue;
			const c = l.lineCents ?? 0;
			if (l.state === 'committed') sums.ordered += c;
			else if (pendingIds.has(l.id)) sums.decide += c;
			else if (l.view?.committable && l.tier !== 'act') sums.approved += c;
			else if (l.view?.committable) sums.within += c;
			else sums.held += c;
		}
		const rows = [
			{ label: 'Ordered', cents: sums.ordered },
			{ label: 'Needs your decision', cents: sums.decide },
			{ label: 'Approved, not ordered yet', cents: sums.approved },
			{ label: 'Within your mandate, can go now', cents: sums.within },
			{ label: 'Held: cannot be ordered as is', cents: sums.held }
		].filter((r) => r.cents > 0);
		return { rows, total: Object.values(sums).reduce((a, b) => a + b, 0) };
	});
</script>

{#if part === 'decide' && rail}
	<section
		id="approval"
		aria-labelledby="appr-h"
		class="scroll-mt-4 rounded-lg border border-rule bg-sheet"
	>
		<!-- One line that always shows; the decisions open below it, one at a time. -->
		<div class="flex items-baseline gap-2 px-3 py-2">
			<h2 id="appr-h" class="text-body font-semibold text-ink">Decide</h2>
			<p class="min-w-0 flex-1 truncate text-meta text-ink-2">
				{decisions.length === 1 ? 'One decision' : `${decisions.length} decisions`}{shortDue
					? ' before '
					: ''}{#if shortDue}<span class="mono text-ink">{shortDue}</span>{/if}
			</p>
		</div>
		{#if showVoid && !folded}
			<p class="flex gap-1.5 border-t border-rule bg-signoff-wash px-3 py-1.5 text-meta text-ink">
				<TriangleAlert size={14} class="mt-0.5 shrink-0 text-signoff" aria-hidden="true" />
				<span
					><b class="font-medium">Your earlier approval no longer applies</b>: the terms changed.</span
				>
			</p>
		{/if}
		{#if !folded}
			<ul class="border-t border-rule">
				{#each decisions as d (d.key)}
					{@const open = openKey === d.key}
					<li
						class="border-b border-rule last:border-b-0"
						onpointerenter={() => (hoverKey = d.key)}
						onpointerleave={() => (hoverKey = null)}
						onfocusin={() => (hoverKey = d.key)}
						onfocusout={() => (hoverKey = null)}
					>
						<button
							type="button"
							class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-well {open
								? 'bg-well/60'
								: ''}"
							aria-expanded={open}
							aria-controls="rail-dec-{d.key}"
							onclick={() => toggle(d.key)}
						>
							{#if d.signOff}<ShieldAlert
									size={15}
									class="shrink-0 text-auth"
									aria-hidden="true"
								/>{:else}<Hand size={15} class="shrink-0 text-auth" aria-hidden="true" />{/if}
							<span class="min-w-0 flex-1 truncate text-meta font-medium text-ink"
								>{d.title ?? d.reason}</span
							>
							<span class="mono shrink-0 text-meta text-ink">{money(d.totalCents)}</span>
							<span class="shrink-0 text-meta text-accent-ink">{open ? 'Close' : 'Review'}</span>
							<ChevronDown
								size={14}
								class="shrink-0 text-ink-3 transition-transform {open ? '' : '-rotate-90'}"
								aria-hidden="true"
							/>
						</button>
						{#if open}
							<div id="rail-dec-{d.key}" class="px-2 pb-2">
								<DecisionCard
									decision={d}
									{names}
									{due}
									{busy}
									headless
									changed={changedIds}
									onapprove={approve}
									onkeep={(ids) => ondeny(ids)}
									onsee={() => onmark?.(d.lineIds, true)}
								/>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
			{#if result}
				<p
					class="landed flex items-center gap-1.5 border-t border-rule px-3 py-1.5 text-meta text-ink"
					role="status"
				>
					<CircleCheck size={14} class="shrink-0 text-ok" aria-hidden="true" />
					<span class="min-w-0 truncate">{result}</span>
				</p>
			{/if}
		{/if}
	</section>
{:else if part === 'decide'}
	<section
		id="approval"
		aria-labelledby="appr-h"
		class="scroll-mt-4 rounded-lg border border-rule bg-sheet"
	>
		<div class="flex items-baseline justify-between gap-2 px-4 pt-3.5">
			<h2 id="appr-h" class="text-heading font-semibold text-ink">Decide</h2>
			<span class="text-meta text-ink-3">delivery {day(plan.deliverBy)}</span>
		</div>

		{#if showVoid && lastInvalidated}
			<div class="mx-4 mt-3 rounded-md bg-signoff-wash px-3 py-2 text-meta leading-snug text-ink">
				<p class="flex gap-2">
					<TriangleAlert size={15} class="mt-px shrink-0 text-signoff" aria-hidden="true" />
					<span>
						<b class="font-medium">Your earlier approval no longer applies</b>: the terms changed ({lastInvalidated.reason ??
							'plan changed'}). Review what changed:
					</span>
				</p>
				{#if changes.length}
					<ul class="mt-1.5 space-y-0.5 pl-6">
						{#each changes as c (c.lineId)}
							<li class="flex flex-wrap items-baseline gap-x-1.5">
								<span class="font-medium">{nameOf(c.productId)}</span>
								{#if c.before && c.after}
									<span class="mono"
										>{num(c.before.qty)} →
										<mark class="bg-signoff/25 px-0.5 text-ink"
											>{num(c.after.qty)} {unitWord(c.after.unit, c.after.qty)}</mark
										>, {money(c.before.lineCents)} →
										<mark class="bg-signoff/25 px-0.5 text-ink">{money(c.after.lineCents)}</mark
										></span
									>
								{:else if c.after}
									<span class="text-ink-2"
										>added: <span class="mono"
											>{num(c.after.qty)}
											{unitWord(c.after.unit, c.after.qty)} · {money(c.after.lineCents)}</span
										></span
									>
								{:else if c.before}
									<span class="text-ink-2"
										>removed (was <span class="mono"
											>{num(c.before.qty)} {unitWord(c.before.unit, c.before.qty)}</span
										>)</span
									>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}

		{#if approval}
			<div class="px-4 pt-3">
				<p class="flex items-center gap-1.5 text-body text-ink">
					{#if ordered}
						<CircleCheck size={16} class="text-accent" aria-hidden="true" />
						<span
							><b class="font-medium">Ordered</b> · {committedN} lines on {orders.length}
							{orders.length === 1 ? 'order' : 'orders'}{lastCommit
								? `, receipt ${lastCommit.receiptId}`
								: ''}. Supplier confirmation is on the receipt.</span
						>
					{:else if granted}
						<CircleCheck size={16} class="text-ok" aria-hidden="true" />
						<span
							><b class="font-medium">You approved these terms</b> · {approvedN} lines. Approved is not
							yet ordered, and not supplier-confirmed.</span
						>
					{:else}
						{#if approval.tier === 'sign_off'}
							<ShieldAlert size={16} class="text-auth" aria-hidden="true" />
						{:else}
							<Hand size={16} class="text-auth" aria-hidden="true" />
						{/if}
						<span
							><b class="font-medium"
								>{decisions.length === 1
									? 'One decision needs you'
									: `${decisions.length} decisions need you`}</b
							>
							· {approvalLines.length}
							{approvalLines.length === 1 ? 'line' : 'lines'} · {money(approvalCents)}</span
						>
					{/if}
				</p>

				{#if pending}
					<ol class="mt-2.5 space-y-2.5">
						{#each decisions as d (d.key)}
							<li>
								<DecisionCard
									decision={d}
									{names}
									{due}
									{busy}
									changed={changedIds}
									onapprove={approve}
									onkeep={(ids) => ondeny(ids)}
									onsee={onmark ? () => seeBriefly(d.lineIds) : undefined}
								/>
							</li>
						{/each}
					</ol>
				{:else}
					<ul class="mt-2.5 space-y-3">
						{#each decided as d (d.key)}
							<li>
								<!-- Grouped by why it needed the chef, with the count and the group's total on the bill's grid. -->
								<p class="{BILL_COLS} items-start text-meta font-medium text-ink">
									<span class="min-w-0"
										>{ordered || granted ? 'Approved' : 'Needed you'}: {d.reason.toLowerCase()}</span
									>
									<span class="mono text-right text-ink-3 tabular-nums"
										>{d.lines.length} {d.lines.length === 1 ? 'line' : 'lines'}</span
									>
									<span class="mono text-right tabular-nums">{money(centsOf(d.lines))}</span>
								</p>
								<p class="text-micro text-ink-3">{d.why}</p>
								<div class="mt-1">
									<BillLines rows={billOf(d.lines)} label={d.reason} />
								</div>
							</li>
						{/each}
					</ul>
				{/if}
				{#if pending && approvedEarlier.length}
					<div class="mt-2.5 rounded-md border border-ok/30 bg-ok-wash/60 px-3 py-2">
						<p class="flex items-center gap-1.5 text-meta font-medium text-ink">
							<CircleCheck size={14} class="text-ok" aria-hidden="true" /> Approved by you, not ordered
							yet
						</p>
						<div class="mt-1">
							<BillLines rows={billOf(approvedEarlier)} label="Approved by you, not ordered yet" />
						</div>
					</div>
				{/if}
			</div>
		{:else if committedN === 0}
			<p class="px-4 pt-3 text-body text-ink-2">
				Nothing needs you: every open line is within the mandate.
			</p>
		{/if}
		<div class="h-3.5"></div>
	</section>
{:else}
	<section
		id="order"
		aria-labelledby="order-h"
		class="scroll-mt-4 rounded-lg border border-rule bg-sheet"
	>
		<div class="flex items-baseline justify-between gap-2 px-4 pt-3.5">
			<h2 id="order-h" class="text-heading font-semibold text-ink">Order</h2>
			<span class="text-meta text-ink-3">delivery {day(plan.deliverBy)}</span>
		</div>
		<!-- The same grid as every bill: the amounts sit in the price column. -->
		<dl
			class="mx-4 mt-3 {BILL_COLS} gap-y-1 border-t border-rule pt-2.5 text-meta"
			aria-label="Where the plan's money stands"
		>
			{#each split.rows as r (r.label)}
				<dt class="col-span-2 text-ink-2">{r.label}</dt>
				<dd class="mono text-right text-ink tabular-nums">{money(r.cents)}</dd>
			{/each}
			<dt class="col-span-2 font-medium text-ink">Plan total, ex VAT</dt>
			<dd class="mono text-right font-medium text-ink tabular-nums">{money(split.total)}</dd>
			<dt class="text-ink-2">Delivery</dt>
			<dd class="col-span-2 text-right text-ink">{day(plan.deliverBy)}</dd>
			{#if approval && pending}
				<!-- An approval can't outlive the order cut-off: past it, nothing it approves can be ordered. -->
				{@const capped = new Date(due).getTime() < new Date(approval.expiresAt).getTime()}
				<dt class="text-ink-2">{capped ? 'Approve before the cut-off' : 'Approval valid until'}</dt>
				<dd class="col-span-2 text-right text-ink">
					{storyTime(capped ? due : approval.expiresAt)}
				</dd>
			{/if}
		</dl>
		{#if approval}
			{#if shortfalls.length}
				<div class="mx-4 mt-2.5 rounded-md bg-well px-3 py-2 text-meta leading-snug text-ink">
					<p class="font-medium">Still not covered after this order</p>
					{#each shortfalls as g (g.kind + g.sentence)}
						<!-- One sentence per reason, the items as chips: the same words never repeat per line. -->
						<p class="mt-1.5 text-ink-2">{g.sentence}</p>
						{#if g.items.length}
							<ul class="mt-1 flex flex-wrap gap-1" aria-label={g.sentence}>
								{#each g.items as it (it.id)}
									<li
										class="inline-flex max-w-full items-center gap-1 rounded-full border border-rule-strong bg-sheet px-2 py-0.5"
										title="{it.name} · {it.qty}"
									>
										<span class="max-w-[12rem] truncate text-ink">{it.name}</span>
										<span class="mono shrink-0 text-ink-3">{it.qty}</span>
									</li>
								{/each}
							</ul>
						{/if}
						{#if g.approve?.length}
							<button
								type="button"
								class="mt-1.5 rounded-md border border-propose px-2.5 py-1 font-medium text-propose hover:bg-propose-wash disabled:opacity-50"
								disabled={busy}
								onclick={() => onapprove(g.approve!)}
								>Approve {g.approve.length === 1 ? 'it' : `these ${g.approve.length}`}</button
							>
						{/if}
					{/each}
				</div>
			{/if}

			<details class="mx-4 mt-3 text-meta text-ink-3">
				<summary class="cursor-pointer select-none hover:text-ink"
					>Audit detail: what the approval is bound to</summary
				>
				<dl class="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
					<dt>Approval</dt>
					<dd class="mono truncate text-right text-ink-2" title={approval.id}>{approval.id}</dd>
					<dt>Plan version</dt>
					<dd class="mono text-right text-ink-2">v{approval.planVersion}</dd>
					<dt>Terms hash</dt>
					<dd class="mono text-right text-ink-2" title={approval.termsHash}>
						{shortHash(approval.termsHash)}
					</dd>
					<dt>Mandate</dt>
					<dd class="mono text-right text-ink-2">v{approval.mandateVersion}</dd>
				</dl>
			</details>
		{/if}

		<div class="mt-3 border-t border-rule px-4 py-3">
			{#if eligible.length || !committedN}
				<button
					bind:this={commitBtn}
					type="button"
					class="flex h-11 w-full items-center justify-between rounded-md px-4 text-body font-medium disabled:cursor-not-allowed disabled:border-rule disabled:bg-well disabled:text-ink-3 {decisions.length
						? 'border border-ink/70 text-ink hover:bg-well'
						: 'bg-accent text-sheet hover:bg-accent-ink'}"
					disabled={busy || eligible.length === 0}
					onclick={oncommit}
				>
					<span
						>{eligible.length
							? decisions.length
								? `Order the ${eligible.length} lines you can now`
								: `Place order: ${eligible.length} lines`
							: 'Nothing to order yet'}</span
					>
					<span class="mono">{eligible.length ? money(eligibleCents) : ''}</span>
				</button>
			{/if}
			{#if pending && eligible.length}
				<p class="mt-1.5 text-meta leading-snug text-ink-3">
					Lines within the mandate can go now; held lines wait for your approval.
				</p>
			{/if}

			{#if lastCommit}
				<div class={eligible.length || !committedN ? 'mt-3' : ''}>
					<Receipt
						receipt={lastCommit}
						orders={orders.length}
						{busy}
						onretry={lastCommit.key ? onretry : undefined}
					/>
				</div>
			{/if}
		</div>
	</section>
{/if}
