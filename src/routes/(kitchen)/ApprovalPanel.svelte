<script lang="ts">
	import { CircleCheck, RotateCcw, ShieldAlert, TriangleAlert, Hand } from '@lucide/svelte';
	import type { Approval, Line, Plan } from '$lib/core/contracts';
	import type { CommitNote } from '$lib/kitchen/kitchen.svelte';
	import type { CommitRecord } from '$lib/kitchen/fixture-server';
	import HoldButton from '$lib/ui/HoldButton.svelte';
	import { money, num, shortHash, day } from '$lib/ui/format';
	import { reasonShort } from '$lib/ui/reasons';

	interface Props {
		plan: Plan;
		approval: Approval | null;
		lastInvalidated: Approval | null;
		orders: CommitRecord[];
		lastCommit: CommitNote | null;
		names: Map<string, string>;
		busy: boolean;
		onapprove: () => void;
		ondeny: () => void;
		oncommit: () => void;
		onretry: () => void;
	}
	let {
		plan,
		approval,
		lastInvalidated,
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
	const eligible = $derived(
		plan.lines.filter(
			(l) =>
				l.state === 'eligible' ||
				(l.state === 'held' && approval?.state === 'granted' && approval.lineIds.includes(l.id))
		)
	);
	const eligibleCents = $derived(eligible.reduce((s, l) => s + (l.lineCents ?? 0), 0));
	const committedN = $derived(plan.lines.filter((l) => l.state === 'committed').length);
	const pending = $derived(approval?.state === 'pending');
	const granted = $derived(approval?.state === 'granted');
	const showVoid = $derived(
		lastInvalidated &&
			approval?.state === 'pending' &&
			!lastInvalidated.reason?.includes('committed')
	);
	const grouped = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, rebuilt on every derive
		const m = new Map<string, Line[]>();
		for (const l of approvalLines) {
			const key =
				l.reasons
					.filter((r) => r !== 'unknown')
					.map(reasonShort)
					.join(' · ') || 'Held';
			m.set(key, [...(m.get(key) ?? []), l]);
		}
		return [...m.entries()];
	});
</script>

<section
	id="approval"
	aria-labelledby="appr-h"
	class="scroll-mt-4 rounded-lg border border-rule bg-sheet"
>
	<div class="flex items-baseline justify-between gap-2 px-4 pt-3.5">
		<h2 id="appr-h" class="text-[14px] font-semibold text-ink">Approve exact terms</h2>
		<span class="mono text-[11.5px] text-ink-3">plan v{plan.version}</span>
	</div>

	{#if showVoid && lastInvalidated}
		<p
			class="mx-4 mt-3 flex gap-2 rounded-md bg-signoff-wash px-3 py-2 text-[12.5px] leading-snug text-ink"
		>
			<TriangleAlert size={15} class="mt-px shrink-0 text-signoff" aria-hidden="true" />
			<span>
				<b class="font-medium">{lastInvalidated.id} voided</b> ({lastInvalidated.reason}). It was
				bound to
				<span class="mono"
					>v{lastInvalidated.planVersion} · {shortHash(lastInvalidated.termsHash)}</span
				>; a yes never rides on changed terms.
			</span>
		</p>
	{/if}

	{#if approval}
		<div class="px-4 pt-3">
			<p class="flex items-center gap-1.5 text-[13.5px] text-ink">
				{#if granted}
					<CircleCheck size={16} class="text-ok" aria-hidden="true" />
					<span><b class="font-medium">Approved</b> by chef · {approvalLines.length} lines</span>
				{:else if approval.tier === 'sign_off'}
					<ShieldAlert size={16} class="text-signoff" aria-hidden="true" />
					<span
						><b class="font-medium">{approvalLines.length} lines need your sign-off</b> · {money(
							approvalCents
						)}</span
					>
				{:else}
					<Hand size={16} class="text-propose" aria-hidden="true" />
					<span
						><b class="font-medium">{approvalLines.length} lines proposed</b> · {money(
							approvalCents
						)}</span
					>
				{/if}
			</p>
			<ul class="mt-2 space-y-2">
				{#each grouped as [reason, lines] (reason)}
					<li>
						<p class="text-[11.5px] font-medium text-ink-3">{reason}</p>
						<ul class="mt-0.5">
							{#each lines as l (l.id)}
								<li class="flex items-baseline justify-between gap-3 text-[12.5px]">
									<span class="min-w-0 truncate text-ink-2"
										>{names.get(l.productId) ?? l.productId}</span
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
		</div>
		<dl
			class="mx-4 mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-rule bg-well px-3 py-2.5 text-[12.5px]"
			aria-label="What this approval is bound to"
		>
			<dt class="text-ink-3">Bound to</dt>
			<dd class="text-right text-ink">{approval.id}</dd>
			<dt class="text-ink-3">Plan version</dt>
			<dd class="mono text-right text-ink">v{approval.planVersion}</dd>
			<dt class="text-ink-3">Terms hash</dt>
			<dd class="mono text-right text-ink" title={approval.termsHash}>
				{shortHash(approval.termsHash)}
			</dd>
			<dt class="text-ink-3">Order total</dt>
			<dd class="mono text-right text-ink">{money(plan.totalCents)}</dd>
			<dt class="text-ink-3">Mandate</dt>
			<dd class="mono text-right text-ink">v{approval.mandateVersion}</dd>
			<dt class="text-ink-3">Delivery · expires</dt>
			<dd class="text-right text-ink">
				{day(plan.deliverBy)} · {day(approval.expiresAt.slice(0, 10))} 17:00
			</dd>
		</dl>
		{#if pending}
			<div class="space-y-1.5 px-4 pt-3">
				<HoldButton
					label="Hold to approve {approvalLines.length} lines"
					disabled={busy}
					onconfirm={onapprove}
				/>
				<button
					type="button"
					class="w-full text-center text-[12.5px] text-ink-3 hover:text-ink"
					disabled={busy}
					onclick={ondeny}>Deny and keep them held</button
				>
			</div>
		{/if}
	{:else if committedN === 0}
		<p class="px-4 pt-3 text-[13px] text-ink-2">
			Nothing needs you: every line is within the mandate.
		</p>
	{/if}

	<div class="mt-3 border-t border-rule px-4 py-3">
		<button
			type="button"
			class="flex h-11 w-full items-center justify-between rounded-md bg-accent px-4 text-[14px] font-medium text-sheet hover:bg-accent-ink disabled:cursor-not-allowed disabled:bg-rule-strong disabled:text-ink-2"
			disabled={busy || eligible.length === 0}
			onclick={oncommit}
		>
			<span
				>{eligible.length
					? `Commit ${eligible.length} lines`
					: committedN
						? `${committedN} lines committed`
						: 'Nothing to commit yet'}</span
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
					{lastCommit.orderId} · {lastCommit.lines} lines · {lastCommit.lines - lastCommit.awaiting} confirmed,
					{lastCommit.awaiting} awaiting supplier (Terminal: ordered, not counted as cover)
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
					<RotateCcw size={13} aria-hidden="true" /> Send the same commit again
				</button>
				<p class="mono mt-1 truncate text-[11px] text-ink-3" title={lastCommit.key}>
					key {lastCommit.key}
				</p>
			</div>
		{/if}
	</div>
</section>
