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
		PackageX
	} from '@lucide/svelte';

	interface Props {
		state: LineState;
		tier?: Tier;
		reasons?: string[];
		approved?: boolean;
		/** The server's read model: when present, authority and the gap come from it, not from reasons. */
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

	const META = {
		committed: {
			label: 'Committed',
			icon: Lock,
			cls: 'text-accent-ink bg-accent-wash border-accent/30'
		},
		undeliverable: {
			label: "Can't deliver",
			icon: Truck,
			cls: 'text-undeliv bg-undeliv-wash border-undeliv/30 border-dashed'
		},
		out: { label: 'Out of stock', icon: Ban, cls: 'text-out bg-out-wash border-out/30' },
		unorderable: { label: 'Unorderable', icon: Ban, cls: 'text-out bg-out-wash border-out/30' },
		sign_off: {
			label: 'Sign-off',
			icon: ShieldAlert,
			cls: 'text-signoff bg-signoff-wash border-signoff/35'
		},
		propose: {
			label: 'Proposed',
			icon: Hand,
			cls: 'text-propose bg-propose-wash border-propose/30'
		},
		approved: {
			label: 'Approved',
			icon: CircleCheck,
			cls: 'text-propose bg-propose-wash border-propose/30'
		},
		eligible: {
			label: 'Within mandate',
			icon: CircleCheck,
			cls: 'text-ok bg-ok-wash border-ok/25'
		},
		blocked: { label: 'Blocked', icon: Ban, cls: 'text-out bg-out-wash border-out/30' },
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
		if (view) return null;
		if (reasons.includes('INSUFFICIENT_STOCK')) return GAP.stock;
		if (reasons.includes('unknown')) return GAP.qty;
		if (reasons.includes('UNKNOWN_REQUIRED'))
			return { label: 'Unconfirmed', title: 'A required fact is not stated; not confirmed cover.' };
		return null;
	});
</script>

<span class="inline-flex flex-wrap items-center gap-1">
	<span
		class="inline-flex h-6 items-center gap-1 rounded-[5px] border px-1.5 text-[12px] leading-none font-medium whitespace-nowrap {m.cls}"
	>
		<m.icon size={13} strokeWidth={2.2} aria-hidden="true" />
		{m.label}
	</span>
	{#if gap}
		<span
			class="inline-flex h-6 items-center gap-1 rounded-[5px] border border-dashed px-1.5 text-[12px] leading-none whitespace-nowrap {gap ===
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
