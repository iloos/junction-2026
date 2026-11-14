<script lang="ts">
	import type { LineState, LineView, Tier } from '$lib/core/contracts';
	import {
		CircleCheck,
		Hand,
		ShieldAlert,
		Ban,
		Truck,
		CircleHelp,
		Lock,
		CircleDashed,
		PackageX,
		ShieldCheck
	} from '@lucide/svelte';

	interface Props {
		state: LineState;
		tier?: Tier;
		reasons?: string[];
		approved?: boolean;
		/** The server's read model: authority and the gap come from it. Without it only the line state shows. */
		view?: LineView;
	}
	let { state, tier, reasons = [], approved = false, view }: Props = $props();

	const kind = $derived.by(() => {
		if (state === 'committed') return 'committed';
		// Core marks real outages `unorderable` with the availability kind as the reason.
		const outage = state === 'rejected' || state === 'unorderable';
		if (outage && reasons.includes('undeliverable')) return 'undeliverable';
		if (outage && reasons.includes('out')) return 'out';
		if (state === 'rejected') return 'out';
		if (state === 'unorderable') return 'unorderable';
		if (view) {
			if (view.committable) return tier && tier !== 'act' ? 'approved' : 'eligible';
			if (view.blockedReason?.effect === 'forbid' && !view.reviewable) return 'blocked';
			if (view.reviewable) return tier === 'sign_off' ? 'sign_off' : 'propose';
		}
		// A granted approval is the line's authority even though core keeps it `held`.
		if (approved) return 'approved';
		if (state === 'held') return tier === 'sign_off' ? 'sign_off' : 'propose';
		if (state === 'eligible') return 'eligible';
		return 'proposed';
	});

	/*
	 * Three axes, three looks (D10, SURFACES §6). Authority (may the agent buy it?) is shape + icon on the blue
	 * authority hue, never a supply colour: "within mandate" is not "supplied". Availability problems are a red
	 * outline (missing). Execution is a small mono tag.
	 */
	const META = {
		committed: {
			label: 'Committed',
			icon: Lock,
			cls: 'font-mono text-micro tracking-normal text-ink-2 bg-well border-rule-strong'
		},
		undeliverable: {
			label: "Can't deliver",
			icon: Truck,
			cls: 'text-sup-missing bg-sheet border-sup-missing/60 border-dashed'
		},
		out: {
			label: 'Out of stock',
			icon: Ban,
			cls: 'text-sup-missing bg-sheet border-sup-missing/60'
		},
		unorderable: {
			label: 'Unorderable',
			icon: Ban,
			cls: 'text-sup-missing bg-sheet border-sup-missing/60'
		},
		sign_off: {
			label: 'Needs sign-off',
			icon: ShieldAlert,
			cls: 'text-auth bg-auth-wash border-auth border-2'
		},
		propose: {
			label: 'Needs your approval',
			icon: Hand,
			cls: 'text-auth bg-sheet border-auth/70 border-dashed'
		},
		approved: {
			label: 'Approved',
			icon: CircleCheck,
			cls: 'text-sheet bg-auth border-auth'
		},
		eligible: {
			label: 'Within mandate',
			icon: ShieldCheck,
			cls: 'text-ink-2 bg-sheet border-rule-strong'
		},
		blocked: { label: 'Forbidden', icon: Ban, cls: 'text-sheet bg-sup-missing border-sup-missing' },
		proposed: { label: 'Draft', icon: CircleDashed, cls: 'text-ink-2 bg-well border-rule' }
	} as const;

	const m = $derived(META[kind]);
	/** The gap, in words that match its cause (the read model splits UNKNOWN_REQUIRED by detail). */
	const GAP: Record<string, { label: string; title: string }> = {
		qty: {
			label: 'Qty unknown',
			title:
				'Terminal item: Valio does not state a quantity. It can be ordered, but never counts as cover.'
		},
		price: {
			label: 'Price unknown',
			title: 'No price in the offer. Approval cannot fix a missing price: re-quote first.'
		},
		dietary_evidence: {
			label: 'Allergens unverified',
			title:
				'No allergen record for this product. The kitchen never delegates an allergen decision.'
		},
		origin: { label: 'Origin unknown', title: 'Origin is not stated; your rules require it.' },
		unit: { label: 'Unit unclear', title: 'The pack size or unit could not be verified.' },
		stock: {
			label: 'Short stock',
			title:
				'Not enough in stock for this quantity at the last quote. Held until covered or replaced.'
		}
	};
	const gap = $derived.by(() => {
		if (state === 'committed' || state === 'rejected' || state === 'unorderable') return null;
		const d = view?.blockedReason?.detail;
		if (d) return GAP[d] ?? null;
		return null;
	});
</script>

<span class="inline-flex flex-wrap items-center gap-1">
	<span
		class="inline-flex h-6 items-center gap-1 rounded-[5px] border px-1.5 text-meta leading-none font-medium whitespace-nowrap {m.cls}"
	>
		<m.icon size={13} strokeWidth={2.2} aria-hidden="true" />
		{m.label}
	</span>
	{#if gap}
		<span
			class="inline-flex h-6 items-center gap-1 rounded-[5px] border border-dashed px-1.5 text-meta leading-none whitespace-nowrap {gap ===
			GAP.stock
				? 'border-out/40 text-out'
				: 'border-ink-3/50 text-ink-2'}"
			title={gap.title}
		>
			{#if gap === GAP.stock}<PackageX
					size={13}
					strokeWidth={2.2}
					aria-hidden="true"
				/>{:else}<CircleHelp size={13} strokeWidth={2.2} aria-hidden="true" />{/if}
			{gap.label}
		</span>
	{/if}
</span>
