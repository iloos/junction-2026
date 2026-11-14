<script lang="ts">
	import { tick } from 'svelte';
	import {
		CircleCheck,
		RotateCcw,
		ShieldAlert,
		TriangleAlert,
		Hand,
		ArrowRight
	} from '@lucide/svelte';
	import type { Approval, Line, Plan } from '$lib/core/contracts';
	import type { CommitNote, TermChange } from '$lib/kitchen/kitchen.svelte';
	import type { CommitRecord } from '$lib/kitchen/fixture-server';
	import HoldButton from '$lib/ui/HoldButton.svelte';
	import { money, num, shortHash, day, storyTime } from '$lib/ui/format';
	import { reasonLong, reasonShort } from '$lib/ui/reasons';
	import { SUBSET_APPROVE } from '$lib/kitchen/capabilities';

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
		onretry
	}: Props = $props();

	const byId = $derived(new Map(plan.lines.map((l) => [l.id, l])));
	const approvalLines = $derived(
		(approval?.lineIds ?? []).map((id) => byId.get(id)).filter((l): l is Line => !!l)
	);
	const approvalCents = $derived(approvalLines.reduce((s, l) => s + (l.lineCents ?? 0), 0));
	// Committable: in-mandate lines, plus held lines a granted approval covers (core keeps them `held`;
	// the approval is their authority).
	// Committable comes from the server's read model; the state/approval rule is the fallback for old outputs.
	const eligible = $derived(
		plan.lines.filter((l) =>
			l.view
				? l.view.committable
				: l.state === 'eligible' ||
					(l.state === 'held' && approval?.state === 'granted' && approval.lineIds.includes(l.id))
		)
	);
	const eligibleCents = $derived(eligible.reduce((s, l) => s + (l.lineCents ?? 0), 0));

	const committedN = $derived(plan.lines.filter((l) => l.state === 'committed').length);
	const pending = $derived(approval?.state === 'pending');
	/** The approval's lines have been bought: show the ordered state, not "approved, not yet ordered". */
	const ordered = $derived(
		approvalLines.length > 0 && approvalLines.every((l) => l.state === 'committed')
	);
	const granted = $derived(approval?.state === 'granted');
	const showVoid = $derived(
		lastInvalidated && pending && !lastInvalidated.reason?.includes('committed')
	);
	const changedIds = $derived(new Set(changes.map((c) => c.lineId)));
	const grouped = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, rebuilt on every derive
		const m = new Map<string, { reasons: string[]; lines: Line[]; signOff: boolean }>();
		for (const l of approvalLines) {
			const reasons = l.reasons.filter((r) => r !== 'unknown' && r !== 'UNKNOWN_REQUIRED');
			const key = reasons.map(reasonShort).join(' · ') || 'Held';
			const g = m.get(key) ?? { reasons, lines: [], signOff: false };
			g.lines.push(l);
			if (l.tier === 'sign_off') g.signOff = true;
			m.set(key, g);
		}
		return [...m.entries()];
	});
	/**
	 * Lines a human already approved in an earlier group decision and that are not ordered yet: committable but not
	 * within the mandate. Read from the server's view (offline: the fixture marks them eligible).
	 */
	const approvedEarlier = $derived(
		plan.lines.filter(
			(l) =>
				!approvalLines.includes(l) &&
				l.state !== 'committed' &&
				l.tier !== undefined &&
				l.tier !== 'act' &&
				(l.view ? l.view.committable : l.state === 'eligible')
		)
	);
	/** In the mandate on its own: eligible, and not because a human approved it. */
	const withinCents = $derived(
		plan.lines
			.filter((l) => l.state === 'eligible' && !approvedEarlier.includes(l))
			.reduce((s, l) => s + (l.lineCents ?? 0), 0)
	);

	/**
	 * One decision per reason group: Review → Confirm exact terms for a routine group; a sign-off group (an allergen
	 * change, a broken requirement) takes a deliberate hold. Approving one group never grants another.
	 */
	let confirming = $state<string | null>(null);
	let confirmBtn = $state<HTMLButtonElement | null>(null);
	let commitBtn = $state<HTMLButtonElement | null>(null);
	async function review(key: string) {
		confirming = key;
		await tick();
		confirmBtn?.focus();
	}
	/** Groups the chef confirmed on screen, per approval (the fallback while core can't grant a subset). */
	let checked = $state<Record<string, boolean>>({});
	const ck = (key: string) => `${approval?.id}:${key}`;
	const oneShot = $derived(SUBSET_APPROVE || grouped.length <= 1);
	const allChecked = $derived(grouped.every(([key]) => checked[ck(key)]));
	async function confirm(lines: Line[], key: string) {
		if (!oneShot) {
			checked = { ...checked, [ck(key)]: true };
			confirming = null;
			return;
		}
		const ok = await onapprove(SUBSET_APPROVE ? lines.map((l) => l.id) : undefined);
		confirming = null;
		await tick();
		if (ok && grouped.length <= 1) commitBtn?.focus();
	}
	async function approveConfirmed() {
		const ok = await onapprove();
		checked = {};
		await tick();
		if (ok) commitBtn?.focus();
	}
	const sum = (ls: Line[]) => ls.reduce((a, l) => a + (l.lineCents ?? 0), 0);
	const nameOf = (id: string) => names.get(id) ?? id;
</script>

<section
	id="approval"
	aria-labelledby="appr-h"
	class="scroll-mt-4 rounded-lg border border-rule bg-sheet"
>
	<div class="flex items-baseline justify-between gap-2 px-4 pt-3.5">
		<h2 id="appr-h" class="text-[14px] font-semibold text-ink">Review the order</h2>
		<span class="text-[12px] text-ink-3">delivery {day(plan.deliverBy)}</span>
	</div>

	{#if showVoid && lastInvalidated}
		<div class="mx-4 mt-3 rounded-md bg-signoff-wash px-3 py-2 text-[12.5px] leading-snug text-ink">
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
									>removed (was <span class="mono">{num(c.before.qty)} {c.before.unit}</span>)</span
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
			<p class="flex items-center gap-1.5 text-[13.5px] text-ink">
				{#if ordered}
					<CircleCheck size={16} class="text-accent" aria-hidden="true" />
					<span
						><b class="font-medium">Ordered</b> · {approvalLines.length} approved lines{lastCommit
							? `, receipt ${lastCommit.receiptId}`
							: ''}. Supplier confirmation is on the receipt below.</span
					>
				{:else if granted}
					<CircleCheck size={16} class="text-ok" aria-hidden="true" />
					<span
						><b class="font-medium">You approved these terms</b> · {approvalLines.length} lines. Approved
						is not yet ordered, and not supplier-confirmed.</span
					>
				{:else}
					{#if approval.tier === 'sign_off'}
						<ShieldAlert size={16} class="text-signoff" aria-hidden="true" />
					{:else}
						<Hand size={16} class="text-propose" aria-hidden="true" />
					{/if}
					<span
						><b class="font-medium"
							>{grouped.length === 1
								? 'One decision needs you'
								: `${grouped.length} decisions need you`}</b
						>
						· {approvalLines.length} lines · {money(approvalCents)}</span
					>
				{/if}
			</p>

			{#if pending}
				<ol class="mt-2.5 space-y-2.5">
					{#each grouped as [key, g] (key)}
						<li
							class="rounded-md border px-3 py-2.5 {g.signOff
								? 'border-signoff/50 bg-signoff-wash/50'
								: 'border-rule'}"
						>
							<div class="flex items-baseline justify-between gap-2">
								<p class="text-[12.5px] font-medium text-ink">{key}</p>
								<p class="mono text-[12.5px] text-ink">{money(sum(g.lines))}</p>
							</div>
							<p class="mt-0.5 text-[11.5px] leading-snug text-ink-2">
								{g.reasons.map(reasonLong).join(' ')}
							</p>
							<ul class="mt-1.5">
								{#each g.lines as l (l.id)}
									<li
										class="flex items-baseline justify-between gap-3 rounded-sm text-[12.5px] {changedIds.has(
											l.id
										)
											? 'bg-signoff-wash'
											: ''}"
									>
										<span class="min-w-0 truncate text-ink-2" title={nameOf(l.productId)}
											>{nameOf(l.productId)}</span
										>
										<span class="mono shrink-0 text-ink">{num(l.qty.value)} {l.qty.unit}</span>
									</li>
								{/each}
							</ul>
							<div class="mt-2 space-y-1.5">
								{#if checked[ck(key)]}
									<p class="flex items-center justify-between gap-2 text-[12.5px] text-ink">
										<span class="flex items-center gap-1.5"
											><CircleCheck size={14} class="text-ok" aria-hidden="true" /> Confirmed by you</span
										>
										<button
											type="button"
											class="text-[12px] text-ink-3 underline underline-offset-2 hover:text-ink"
											onclick={() => (checked = { ...checked, [ck(key)]: false })}>Undo</button
										>
									</p>
								{:else if confirming === key}
									<p class="text-[12.5px] text-ink">
										{oneShot ? 'Approve' : 'Confirm'} exactly these {g.lines.length} lines, {money(
											sum(g.lines)
										)}, for delivery {day(plan.deliverBy)}?{grouped.length > 1
											? ' The other decisions stay open.'
											: ''}
									</p>
									<div class="flex gap-2">
										<button
											bind:this={confirmBtn}
											type="button"
											class="h-9 flex-1 rounded-md bg-ink px-3 text-[13px] font-medium text-sheet disabled:opacity-50"
											disabled={busy}
											onclick={() => confirm(g.lines, key)}>Confirm exact terms</button
										>
										<button
											type="button"
											class="h-9 rounded-md border border-rule-strong px-3 text-[13px] text-ink"
											onclick={() => (confirming = null)}>Cancel</button
										>
									</div>
								{:else if g.signOff}
									<HoldButton
										label="Hold to sign off {g.lines.length} {g.lines.length === 1
											? 'line'
											: 'lines'}"
										disabled={busy}
										onconfirm={() => void confirm(g.lines, key)}
									/>
								{:else}
									<button
										type="button"
										class="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-ink/70 text-[13px] font-medium text-ink hover:bg-well disabled:opacity-50"
										disabled={busy}
										onclick={() => review(key)}
										>{oneShot ? 'Approve' : 'Review'}
										{g.lines.length}
										{g.lines.length === 1 ? 'line' : 'lines'}
										<ArrowRight size={14} aria-hidden="true" /></button
									>
								{/if}
								{#if SUBSET_APPROVE && confirming !== key}
									<button
										type="button"
										class="w-full text-center text-[12px] text-ink-3 hover:text-ink"
										disabled={busy}
										onclick={() => ondeny(g.lines.map((l) => l.id))}>Keep these held</button
									>
								{/if}
							</div>
						</li>
					{/each}
				</ol>
				{#if !oneShot}
					<div class="mt-2.5 space-y-1.5">
						{#if allChecked}
							<button
								type="button"
								class="h-10 w-full rounded-md bg-ink px-3 text-[13.5px] font-medium text-sheet disabled:opacity-50"
								disabled={busy}
								onclick={approveConfirmed}
								>Approve the {grouped.length} confirmed decisions · {money(approvalCents)}</button
							>
						{:else}
							<p class="text-[12px] leading-snug text-ink-3">
								Confirm each decision on its own; one approval of these exact terms is sent when all
								{grouped.length} are confirmed.
							</p>
						{/if}
					</div>
				{/if}
				{#if !SUBSET_APPROVE}
					<button
						type="button"
						class="mt-1.5 w-full text-center text-[12px] text-ink-3 hover:text-ink"
						disabled={busy}
						onclick={() => ondeny()}>Keep everything held</button
					>
				{/if}
			{:else}
				<ul class="mt-2.5 space-y-3">
					{#each grouped as [key, g] (key)}
						<li>
							<p class="text-[12px] font-medium text-ink">
								{ordered || granted ? 'Approved because' : 'Why it needs you'}: {key.toLowerCase()}
							</p>
							<p class="text-[11.5px] leading-snug text-ink-3">
								{g.reasons.map(reasonLong).join(' ')}
							</p>
							<ul class="mt-1">
								{#each g.lines as l (l.id)}
									<li
										class="flex items-baseline justify-between gap-3 rounded-sm text-[12.5px] {changedIds.has(
											l.id
										)
											? 'bg-signoff-wash'
											: ''}"
									>
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
			{#if approvedEarlier.length}
				<div class="mt-2.5 rounded-md border border-ok/30 bg-ok-wash/60 px-3 py-2">
					<p class="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
						<CircleCheck size={14} class="text-ok" aria-hidden="true" /> Approved by you, not ordered
						yet
					</p>
					<ul class="mt-1">
						{#each approvedEarlier as l (l.id)}
							<li class="flex items-baseline justify-between gap-3 text-[12.5px]">
								<span class="min-w-0 truncate text-ink-2">{nameOf(l.productId)}</span>
								<span class="mono shrink-0 text-ink">{num(l.qty.value)} {l.qty.unit}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>

		<dl
			class="mx-4 mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-rule pt-2.5 text-[12.5px]"
		>
			<dt class="text-ink-2">These lines</dt>
			<dd class="mono text-right text-ink">{money(approvalCents)}</dd>
			<dt class="text-ink-2">Within your mandate already</dt>
			<dd class="mono text-right text-ink">{money(withinCents)}</dd>
			<dt class="font-medium text-ink">Order total, ex VAT</dt>
			<dd class="mono text-right font-medium text-ink">{money(plan.totalCents)}</dd>
			<dt class="text-ink-2">Delivery</dt>
			<dd class="text-right text-ink">{day(plan.deliverBy)}</dd>
			{#if !ordered}
				<dt class="text-ink-2">Approval valid until</dt>
				<dd class="text-right text-ink">{storyTime(approval.expiresAt)}</dd>
			{/if}
		</dl>
		{#if shortfalls.length}
			<div class="mx-4 mt-2.5 rounded-md bg-well px-3 py-2 text-[12px] leading-snug text-ink">
				<p class="font-medium">Still not covered after this order</p>
				<ul class="mt-0.5 list-disc pl-4 text-ink-2">
					{#each shortfalls as s (s)}<li>{s}</li>{/each}
				</ul>
			</div>
		{/if}

		<details class="mx-4 mt-3 text-[12px] text-ink-3">
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
	{:else if committedN === 0}
		<p class="px-4 pt-3 text-[13px] text-ink-2">
			Nothing needs you: every open line is within the mandate.
		</p>
	{/if}

	<div class="mt-3 border-t border-rule px-4 py-3">
		<button
			bind:this={commitBtn}
			type="button"
			class="flex h-11 w-full items-center justify-between rounded-md bg-accent px-4 text-[14px] font-medium text-sheet hover:bg-accent-ink disabled:cursor-not-allowed disabled:bg-rule-strong disabled:text-ink-2"
			disabled={busy || eligible.length === 0}
			onclick={oncommit}
		>
			<span
				>{eligible.length
					? `Place order: ${eligible.length} lines`
					: committedN
						? `${committedN} lines ordered`
						: 'Nothing to order yet'}</span
			>
			<span class="mono">{eligible.length ? money(eligibleCents) : ''}</span>
		</button>
		{#if pending && eligible.length}
			<p class="mt-1.5 text-[12px] leading-snug text-ink-3">
				Lines within the mandate can go now; held lines wait for your approval.
			</p>
		{/if}

		{#if lastCommit}
			<div
				class="mt-3 rounded-md border border-accent/30 bg-accent-wash/60 px-3 py-2.5 text-[12.5px]"
			>
				<p class="flex items-baseline justify-between gap-2 text-ink">
					<span class="font-medium">Receipt {lastCommit.receiptId}</span>
					<span class="mono">{money(lastCommit.totalCents)}</span>
				</p>
				<p class="mt-0.5 text-ink-2">
					{lastCommit.lines} lines ordered: {lastCommit.lines - lastCommit.awaiting} confirmed by the
					simulated supplier, {lastCommit.awaiting} awaiting the supplier (Terminal: not counted as cover)
				</p>
				{#if lastCommit.replayed}
					<p class="mt-1.5 font-medium text-accent-ink">
						Same key, same receipt. No second order: {orders.length}
						{orders.length === 1 ? 'order' : 'orders'} on this plan.
					</p>
				{/if}
				<button
					type="button"
					class="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-accent/40 bg-sheet px-2.5 text-[12.5px] font-medium text-ink hover:bg-well"
					disabled={busy}
					onclick={onretry}
				>
					<RotateCcw size={13} aria-hidden="true" /> Send the same order again
				</button>
				<p class="mono mt-1 truncate text-[11px] text-ink-3" title={lastCommit.key}>
					{lastCommit.orderId} · key {lastCommit.key}
				</p>
			</div>
		{/if}
	</div>
</section>
