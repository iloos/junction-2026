<script lang="ts">
	import { tick } from 'svelte';
	import { CircleCheck, ShieldAlert, TriangleAlert, Hand } from '@lucide/svelte';
	import type { Approval, Line, Plan } from '$lib/core/contracts';
	import type { CommitNote, TermChange } from '$lib/kitchen/kitchen.svelte';
	import type { CommitRecord } from '$lib/kitchen/fixture-server';
	import DecisionCard from '$lib/ui/DecisionCard.svelte';
	import Receipt from '$lib/ui/Receipt.svelte';
	import { decisionsDue, decisionsOf } from '$lib/ui/decisions';
	import { money, num, shortHash, day, storyTime } from '$lib/ui/format';

	interface Props {
		plan: Plan;
		approval: Approval | null;
		lastInvalidated: Approval | null;
		/** Lines whose terms differ from the voided approval the chef saw. */
		changes: TermChange[];
		/** What the order still does not cover, in plain words. */
		shortfalls: string[];
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
		part
	}: Props = $props();

	const byId = $derived(new Map(plan.lines.map((l) => [l.id, l])));
	const approvalLines = $derived(
		(approval?.lineIds ?? []).map((id) => byId.get(id)).filter((l): l is Line => !!l)
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
		const ok = await onapprove(lineIds);
		await tick();
		if (ok && decisions.length === 0) commitBtn?.focus();
		return ok;
	}
	const nameOf = (id: string) => names.get(id) ?? id;

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

{#if part === 'decide'}
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
											>{num(c.after.qty)} {c.after.unit}</mark
										>, {money(c.before.lineCents)} →
										<mark class="bg-signoff/25 px-0.5 text-ink">{money(c.after.lineCents)}</mark
										></span
									>
								{:else if c.after}
									<span class="text-ink-2"
										>added: <span class="mono"
											>{num(c.after.qty)} {c.after.unit} · {money(c.after.lineCents)}</span
										></span
									>
								{:else if c.before}
									<span class="text-ink-2"
										>removed (was <span class="mono">{num(c.before.qty)} {c.before.unit}</span
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
							><b class="font-medium">You approved these terms</b> · {approvalLines.length} lines. Approved
							is not yet ordered, and not supplier-confirmed.</span
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
							· {approvalLines.length} lines · {money(approvalCents)}</span
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
								/>
							</li>
						{/each}
					</ol>
				{:else}
					<ul class="mt-2.5 space-y-3">
						{#each decided as d (d.key)}
							<li>
								<p class="text-meta font-medium text-ink">
									{ordered || granted ? 'Approved because' : 'Why it needed you'}: {d.reason.toLowerCase()}
								</p>
								<p class="text-micro text-ink-3">{d.why}</p>
								<ul class="mt-1">
									{#each d.lines as l (l.id)}
										<li class="flex items-baseline justify-between gap-3 text-meta">
											<span class="min-w-0 truncate text-ink-2" title={nameOf(l.productId)}
												>{nameOf(l.productId)}</span
											>
											<span class="mono shrink-0 text-ink"
												>{num(l.qty.value)} {l.qty.unit} · {money(l.lineCents)}</span
											>
										</li>
									{/each}
								</ul>
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
						<ul class="mt-1">
							{#each approvedEarlier as l (l.id)}
								<li class="flex items-baseline justify-between gap-3 text-meta">
									<span class="min-w-0 truncate text-ink-2">{nameOf(l.productId)}</span>
									<span class="mono shrink-0 text-ink">{num(l.qty.value)} {l.qty.unit}</span>
								</li>
							{/each}
						</ul>
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
		<dl
			class="mx-4 mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-rule pt-2.5 text-meta"
			aria-label="Where the plan's money stands"
		>
			{#each split.rows as r (r.label)}
				<dt class="text-ink-2">{r.label}</dt>
				<dd class="mono text-right text-ink">{money(r.cents)}</dd>
			{/each}
			<dt class="font-medium text-ink">Plan total, ex VAT</dt>
			<dd class="mono text-right font-medium text-ink">{money(split.total)}</dd>
			<dt class="text-ink-2">Delivery</dt>
			<dd class="text-right text-ink">{day(plan.deliverBy)}</dd>
			{#if approval && pending}
				<dt class="text-ink-2">Approval valid until</dt>
				<dd class="text-right text-ink">{storyTime(approval.expiresAt)}</dd>
			{/if}
		</dl>
		{#if approval}
			{#if shortfalls.length}
				<div class="mx-4 mt-2.5 rounded-md bg-well px-3 py-2 text-meta leading-snug text-ink">
					<p class="font-medium">Still not covered after this order</p>
					<ul class="mt-0.5 list-disc pl-4 text-ink-2">
						{#each shortfalls as s (s)}<li>{s}</li>{/each}
					</ul>
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
