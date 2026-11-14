<script lang="ts">
	import type { LineState, Tier } from '$lib/core/contracts';
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
	}
	let { state, tier, reasons = [], approved = false }: Props = $props();

	const kind = $derived.by(() => {
		if (state === 'committed') return 'committed';
		// Core marks real outages `unorderable` with the availability kind as the reason.
		const outage = state === 'rejected' || state === 'unorderable';
		if (outage && reasons.includes('undeliverable')) return 'undeliverable';
		if (outage && reasons.includes('out')) return 'out';
		if (state === 'rejected') return 'out';
		if (state === 'unorderable') return 'unorderable';
		if (state === 'held') return tier === 'sign_off' ? 'sign_off' : 'propose';
		if (approved) return 'approved';
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
		proposed: { label: 'Draft', icon: CircleDashed, cls: 'text-ink-2 bg-well border-rule' }
	} as const;

	const m = $derived(META[kind]);
	const short = $derived(reasons.includes('INSUFFICIENT_STOCK'));
	const unknown = $derived(reasons.includes('unknown') || reasons.includes('UNKNOWN_REQUIRED'));
</script>

<span class="inline-flex flex-wrap items-center gap-1">
	<span
		class="inline-flex h-6 items-center gap-1 rounded-[5px] border px-1.5 text-[12px] leading-none font-medium whitespace-nowrap {m.cls}"
	>
		<m.icon size={13} strokeWidth={2.2} aria-hidden="true" />
		{m.label}
	</span>
	{#if unknown && state !== 'rejected' && state !== 'unorderable'}
		<span
			class="inline-flex h-6 items-center gap-1 rounded-[5px] border border-dashed border-ink-3/50 px-1.5 text-[12px] leading-none whitespace-nowrap text-ink-2"
			title="Terminal item: Valio does not state a quantity. It is ordered, but never counted as cover."
		>
			<CircleHelp size={13} strokeWidth={2.2} aria-hidden="true" />
			Qty unknown
		</span>
	{/if}
	{#if short && state !== 'committed'}
		<span
			class="inline-flex h-6 items-center gap-1 rounded-[5px] border border-out/40 px-1.5 text-[12px] leading-none whitespace-nowrap text-out"
			title="Not enough in stock for this quantity at the last quote. Held until covered or replaced."
		>
			<PackageX size={13} strokeWidth={2.2} aria-hidden="true" />
			Short stock
		</span>
	{/if}
</span>
