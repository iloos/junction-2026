<script lang="ts">
	import { Ban, ChefHat, CircleHelp, Clock3, TriangleAlert, Truck, Wheat } from '@lucide/svelte';
	import type { RescueView } from '$lib/kitchen/view-model';
	import ScoreBar from '$lib/ui/ScoreBar.svelte';
	import RankingStrip from '$lib/ui/viz/RankingStrip.svelte';
	import { money, num, fixed } from '$lib/ui/format';
	import { reasonShort } from '$lib/ui/reasons';

	interface Props {
		rescue: RescueView;
		grams: number;
		onfit: (g: number) => void;
	}
	let { rescue, grams, onfit }: Props = $props();

	const maxScore = $derived(
		Math.max(0.5, ...rescue.candidates.map((c) => (c.rejected.length ? 0 : (c.score?.total ?? 0))))
	);

	function tierText(t: string) {
		return t === 'sign_off' ? 'Sign-off' : t === 'propose' ? 'One tap' : 'Within mandate';
	}
	function tierCls(t: string) {
		return t === 'sign_off' ? 'text-signoff' : t === 'propose' ? 'text-propose' : 'text-ok';
	}
	// Phone: viable candidates in rank order, then the first few exclusions.
	const viableCards = $derived(
		rescue.candidates
			.filter((c) => !c.rejected.length)
			.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
	);
	const rejectedCards = $derived(rescue.candidates.filter((c) => c.rejected.length));
	const phoneCards = $derived([...viableCards.slice(0, 4), ...rejectedCards.slice(0, 2)]);
	const hiddenCards = $derived(rescue.candidates.length - phoneCards.length);

	const readyCounts = $derived.by(() => {
		const c = { out: 0, undeliverable: 0, unknown: 0 };
		for (const x of rescue.candidates) {
			if (x.rejected.includes('out')) c.out++;
			else if (x.rejected.includes('undeliverable')) c.undeliverable++;
			else if (x.rejected.includes('unknown')) c.unknown++;
		}
		return c;
	});
</script>

<div class="rounded-md border border-rule bg-sheet">
	<p class="border-b border-rule px-4 py-2.5 text-[13.5px] text-ink">
		<span class="font-medium">Rescue.</span>
		{rescue.summary}
	</p>

	{#if rescue.kind === 'product' || rescue.kind === 'none'}
		<!-- Desktop: the ranking strip; the full table is a detail. Phone: stacked candidate cards. -->
		<div class="hidden px-2 pt-2 md:block">
			<RankingStrip candidates={rescue.candidates} />
		</div>
		<ol class="space-y-2 px-3 py-3 md:hidden">
			{#each phoneCards as c (c.productId)}
				{@const rej = c.rejected.length > 0}
				<li
					class="rounded-md border px-3 py-2.5 {c.chosen
						? 'border-accent/40 bg-accent-wash/60'
						: c.recommended
							? 'border-propose/40 bg-propose-wash/60'
							: 'border-rule'}"
				>
					<div class="flex items-start justify-between gap-3">
						<p
							class="min-w-0 text-[13.5px] leading-snug font-medium {rej
								? 'text-ink-2'
								: 'text-ink'}"
						>
							<span class="mono mr-1 text-ink-3">{c.rank ?? '–'}</span>{c.name}
						</p>
						{#if c.score && !rej}<span class="mono shrink-0 text-[13px] text-ink"
								>{c.score.total.toFixed(2)}</span
							>{/if}
					</div>
					<p class="mono mt-0.5 text-[11.5px] text-ink-3">
						{c.productId} · {c.origin ? c.origin.toUpperCase() : 'origin ?'}
					</p>
					<dl class="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
						<dt class="text-ink-3">Availability</dt>
						<dd class="text-ink">{c.availableText}</dd>
						<dt class="text-ink-3">Price</dt>
						<dd class="mono text-ink">{c.perKgCents ? `${money(c.perKgCents)} / kg` : '—'}</dd>
						{#if rej || c.kind === 'unknown' || c.chosen}
							<dt class="text-ink-3">Covers</dt>
							<dd class="mono {c.partial ? 'text-signoff' : 'text-ink'}">
								{rej || c.kind === 'unknown' ? '0 kg (not cover)' : `${fixed(c.coverValue)} kg`}
							</dd>
						{/if}
					</dl>
					<p
						class="mt-1.5 text-[12.5px] {rej
							? c.kind === 'undeliverable'
								? 'text-undeliv'
								: 'text-out'
							: 'text-ink'}"
					>
						{c.verdict}
						{#if c.chosen}<span class="text-accent-ink"> · in your order</span>{/if}
						{#if c.recommended && !c.chosen}<span class="text-propose">
								· these rules pick</span
							>{/if}
					</p>
				</li>
			{/each}
			{#if hiddenCards}
				<li class="px-1 text-[12px] text-ink-3">+{hiddenCards} more excluded by a hard rule</li>
			{/if}
		</ol>
		<details class="border-t border-rule">
			<summary class="cursor-pointer px-4 py-2 text-[12.5px] text-ink-2 select-none hover:text-ink"
				>All {rescue.candidates.length} candidates, every column</summary
			>
			<div class="overflow-x-auto">
				<table class="w-full min-w-[720px] text-[13px]">
					<thead>
						<tr class="text-left text-[11.5px] font-medium text-ink-3">
							<th class="w-9 py-2 pl-4 font-medium">#</th>
							<th class="py-2 font-medium">Candidate</th>
							<th class="py-2 font-medium">Availability</th>
							<th class="py-2 pr-3 text-right font-medium">€/kg</th>
							<th class="py-2 pr-3 text-right font-medium">Covers</th>
							<th class="py-2 font-medium">Score under your rules</th>
							<th class="py-2 pr-4 font-medium">Verdict</th>
						</tr>
					</thead>
					<tbody>
						{#each rescue.candidates as c (c.productId)}
							{@const rej = c.rejected.length > 0}
							<tr
								class="border-t border-rule align-top transition-colors duration-300 {c.chosen
									? 'bg-accent-wash/70'
									: ''} {rej ? 'text-ink-3' : ''}"
							>
								<td class="mono py-2.5 pl-4 {c.chosen ? 'font-medium text-accent-ink' : ''}">
									{c.rank ?? '–'}
								</td>
								<td class="py-2.5 pr-3">
									<div class="font-medium {rej ? 'text-ink-2' : 'text-ink'}">{c.name}</div>
									<div class="mono text-[11.5px] text-ink-3">
										{c.productId} · {c.origin ? c.origin.toUpperCase() : 'origin ?'}
										{#if c.reliability !== undefined}· rel {c.reliability.toFixed(2)}{/if}
										{#if c.co2PerKg !== undefined}· {num(c.co2PerKg, 1)} kg CO₂e/kg{/if}
									</div>
								</td>
								<td class="py-2.5 pr-3 whitespace-nowrap">
									<span class="inline-flex items-center gap-1">
										{#if c.kind === 'unknown'}<CircleHelp size={13} aria-hidden="true" />{/if}
										{#if c.kind === 'out'}<Ban size={13} class="text-out" aria-hidden="true" />{/if}
										{#if c.kind === 'undeliverable'}<Truck
												size={13}
												class="text-undeliv"
												aria-hidden="true"
											/>{/if}
										{c.availableText}
									</span>
								</td>
								<td class="mono py-2.5 pr-3 text-right"
									>{c.perKgCents ? money(c.perKgCents) : '—'}</td
								>
								<td class="mono py-2.5 pr-3 text-right whitespace-nowrap">
									{#if rej}
										<span class="text-ink-3">0 kg</span>
									{:else}
										<span class={c.partial ? 'text-signoff' : ''}>{fixed(c.coverValue)} kg</span>
									{/if}
								</td>
								<td class="py-2.5 pr-3">
									{#if c.score && !rej}
										<ScoreBar score={c.score} max={maxScore} />
									{:else}
										<span class="text-[12px]">not ranked</span>
									{/if}
								</td>
								<td class="py-2.5 pr-4">
									<div
										class={rej
											? c.kind === 'undeliverable'
												? 'text-undeliv'
												: c.rejected.includes('unknown')
													? 'text-ink-2'
													: 'text-out'
											: 'text-ink'}
									>
										{c.verdict}
									</div>
									{#if !rej}
										<div class="text-[12px] {tierCls(c.tier)}">
											{tierText(c.tier)}{#if c.holdReasons.length}: {c.holdReasons
													.map(reasonShort)
													.join(', ')}{/if}
											{#if c.chosen}<span class="text-accent-ink"> · in your order</span>{/if}
											{#if c.recommended && !c.chosen}<span class="text-propose">
													· these rules pick</span
												>{/if}
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
		{#if rescue.residual}
			<div
				class="flex flex-wrap items-center justify-between gap-3 border-t border-rule bg-signoff-wash px-4 py-3"
			>
				<p class="flex items-start gap-2 text-[13.5px] text-ink">
					<TriangleAlert size={16} class="mt-0.5 shrink-0 text-signoff" aria-hidden="true" />
					<span>
						<b class="font-medium">Shortfall, stated:</b>
						{rescue.residual.text}. No option covers it all under your rules.
					</span>
				</p>
				{#if rescue.residual.fitGrams && rescue.residual.fitGrams < grams}
					<button
						type="button"
						class="h-8 rounded-md border border-signoff/50 bg-sheet px-3 text-[13px] font-medium text-ink hover:bg-well"
						onclick={() => onfit(rescue.residual!.fitGrams!)}
					>
						Serve {rescue.residual.fitGrams} g per guest instead
					</button>
				{/if}
			</div>
		{/if}
	{:else if rescue.make}
		{@const m = rescue.make}
		<div class="grid gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
			<div class="border-b border-rule px-4 py-3 md:border-r md:border-b-0">
				<p class="text-[12px] font-medium text-ink-3">Ready-made, checked</p>
				<ul class="mt-2 space-y-1.5 text-[13px]">
					{#each rescue.candidates as c (c.productId)}
						<li class="flex items-start justify-between gap-3">
							<span class="min-w-0 text-ink-2">
								<span class="block truncate">{c.name}</span>
								<span class="mono text-[11.5px] text-ink-3">{c.productId}</span>
							</span>
							<span
								class="shrink-0 text-[12px] whitespace-nowrap {c.kind === 'undeliverable'
									? 'text-undeliv'
									: c.kind === 'out'
										? 'text-out'
										: 'text-ink-2'}"
							>
								{c.kind === 'unknown' ? 'Qty unknown' : reasonShort(c.kind)}
							</span>
						</li>
					{/each}
				</ul>
				<p class="mt-2 text-[12px] leading-snug text-ink-3">
					{readyCounts.out} out of stock · {readyCounts.undeliverable} can't be delivered · {readyCounts.unknown}
					unknown quantity (never counted as cover)
				</p>
			</div>
			<div class="px-4 py-3">
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<p class="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink">
						<ChefHat size={15} class="text-accent" aria-hidden="true" />
						{m.title}
					</p>
					<p class="text-[12.5px] text-ink-2">
						<span class="mono text-ink">{money(m.totalCents)}</span> vs
						<span class="mono">{money(m.vsReadyMadeCents)}</span> ready-made
					</p>
				</div>
				<table class="mt-2 w-full text-[12.5px]">
					<tbody>
						{#each m.ingredients as ing (ing.productId)}
							<tr class="border-t border-rule first:border-t-0">
								<td class="py-1.5 pr-2">
									<span class="text-ink">{ing.name}</span>
									<span class="mono block text-[11px] text-ink-3"
										>{ing.productId} · {ing.origin?.toUpperCase() ?? '?'} · {ing.need}</span
									>
								</td>
								<td class="mono py-1.5 pr-2 text-right whitespace-nowrap text-ink"
									>{num(ing.qty)} {ing.unit}</td
								>
								<td class="py-1.5 pr-2 text-right text-[11.5px] whitespace-nowrap text-ok"
									>{ing.availText}</td
								>
								<td class="mono py-1.5 text-right whitespace-nowrap">{money(ing.lineCents)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<ul class="mt-2 space-y-1 text-[12.5px] leading-snug text-ink-2">
					<li class="flex gap-1.5">
						<Clock3 size={13} class="mt-0.5 shrink-0" aria-hidden="true" />{m.labourNote} · {m.recipeNote}
					</li>
					{#if m.allergenNote}
						<li class="flex gap-1.5 text-ink">
							<Wheat
								size={13}
								class="mt-0.5 shrink-0 text-signoff"
								aria-hidden="true"
							/>{m.allergenNote}
						</li>
					{/if}
					{#each m.caveats as c (c)}
						<li class="flex gap-1.5">
							<TriangleAlert size={13} class="mt-0.5 shrink-0" aria-hidden="true" />{c}
						</li>
					{/each}
				</ul>
				<p class="mt-2 text-[12px] {tierCls(m.tier)}">
					{tierText(m.tier)}{#if m.holdReasons.length}: {m.holdReasons
							.map(reasonShort)
							.join(', ')}{/if}
				</p>
			</div>
		</div>
	{/if}
</div>
