<script lang="ts">
	/**
	 * Pick a delivery day for a kitchen. The next three weeks as a Monday-first grid, and "Later…" for any month.
	 * Each day says in one word whether a delivery can still be ordered for it, with icons for what else is on
	 * it: the kitchen's events, decide-before times, deliveries, holidays and festivities. The line under the grid
	 * explains the day in focus. Days come from /kitchen-api/calendar-days (core/calendar.ts `calendarDays`), the
	 * same facts as the calendar feed, on the scenario clock.
	 */
	import { Popover } from 'bits-ui';
	import {
		Ban,
		CalendarDays,
		ChefHat,
		ChevronLeft,
		ChevronRight,
		Hand,
		PartyPopper,
		Truck
	} from '@lucide/svelte';
	import type { CalendarDay, DayMark } from '$lib/core/calendar';
	import {
		cellWord,
		daySentence,
		markLine,
		monthRange,
		pickable,
		shiftMonth,
		weeksOf,
		type PickModel
	} from './day-picker';
	import { day as dayLabel } from './format';

	let {
		kitchenId,
		value = $bindable(null),
		model = 'any',
		label = 'Delivery day',
		days: given,
		onselect
	}: {
		kitchenId: string;
		/** The picked day, YYYY-MM-DD. */
		value?: string | null;
		/** Which cut-off decides whether a day can be picked: 'any' allows Stock-only days. */
		model?: PickModel;
		label?: string;
		/** Days to show instead of fetching (tests, or a page that already has them). */
		days?: CalendarDay[];
		onselect?: (date: string) => void;
	} = $props();

	let fetched = $state<CalendarDay[] | null>(null);
	let failed = $state(false);
	let focusDate = $state<string | null>(null);
	// "Later…": one month at a time, fetched on open.
	let later = $state<{ open: boolean; month: string; days: CalendarDay[]; loading: boolean }>({
		open: false,
		month: '',
		days: [],
		loading: false
	});

	async function fetchDays(from?: string, to?: string): Promise<CalendarDay[] | null> {
		const q = [`kitchen=${encodeURIComponent(kitchenId)}`, from && `from=${from}`, to && `to=${to}`]
			.filter(Boolean)
			.join('&');
		try {
			const r = await fetch(`/kitchen-api/calendar-days?${q}`, { cache: 'no-store' });
			if (!r.ok) return null;
			return ((await r.json()) as { days: CalendarDay[] }).days;
		} catch {
			return null;
		}
	}

	$effect(() => {
		if (given) return;
		const id = kitchenId;
		let gone = false;
		fetched = null;
		failed = false;
		void fetchDays().then((d) => {
			if (gone || id !== kitchenId) return;
			if (d) fetched = d;
			else failed = true;
		});
		return () => (gone = true);
	});

	const days = $derived(given ?? fetched ?? []);
	const weeks = $derived(weeksOf(days));
	const shown = $derived(
		days.find((d) => d.date === focusDate) ??
			days.find((d) => d.date === value) ??
			later.days.find((d) => d.date === value) ??
			null
	);
	const valueOutside = $derived(
		Boolean(value && days.length && !days.some((d) => d.date === value))
	);

	function pick(d: CalendarDay) {
		if (!pickable(d, model)) return;
		value = d.date;
		later.open = false;
		onselect?.(d.date);
	}

	const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

	/** Arrow keys move by a day or a week inside one grid; Home/End to the week's ends. */
	function onKey(e: KeyboardEvent, list: CalendarDay[]) {
		const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
		const target = e.target as HTMLElement;
		const i = list.findIndex((d) => d.date === target.dataset.date);
		if (i < 0) return;
		const col = WEEK.indexOf(list[i].weekday);
		const j = step ? i + step : e.key === 'Home' ? i - col : e.key === 'End' ? i + 6 - col : null;
		if (j === null) return;
		e.preventDefault();
		const next = list[Math.max(0, Math.min(list.length - 1, j))];
		target
			.closest('[data-grid]')
			?.querySelector<HTMLButtonElement>(`[data-date="${next.date}"]`)
			?.focus();
	}

	const ICONS = {
		event: ChefHat,
		decision: Hand,
		delivery: Truck,
		festivity: PartyPopper,
		holiday: Ban,
		eve: Ban
	} as const;
	const ICON_ORDER: DayMark['kind'][] = [
		'event',
		'decision',
		'delivery',
		'holiday',
		'festivity',
		'eve'
	];
	const iconsOf = (d: CalendarDay) =>
		ICON_ORDER.filter((k) => d.marks.some((m) => m.kind === k))
			.slice(0, 3)
			.map((k) => ({ kind: k, Icon: ICONS[k] }));

	const ariaOf = (d: CalendarDay) => [daySentence(d, model), ...d.marks.map(markLine)].join(' ');

	const monthName = (m: string) =>
		new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
			new Date(`${m}-01T12:00:00Z`)
		);
	async function loadMonth(m: string) {
		later.month = m;
		later.loading = true;
		const { from, to } = monthRange(m);
		const d = await fetchDays(from, to);
		if (later.month !== m) return;
		later.days = d ?? [];
		later.loading = false;
	}
	function openLater(open: boolean) {
		later.open = open;
		if (open && !later.month) {
			const start = (value && value > (days.at(-1)?.date ?? '') ? value : days.at(-1)?.date) ?? '';
			if (start) void loadMonth(start.slice(0, 7));
		}
	}
</script>

{#snippet grid(list: CalendarDay[], rows: (CalendarDay | null)[][], caption: string)}
	<div role="group" aria-label={caption} data-grid class="grid grid-cols-7 gap-1">
		{#each ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as w (w)}
			<span class="pb-0.5 text-center text-micro text-ink-3" aria-hidden="true">{w}</span>
		{/each}
		{#each rows as week, wi (wi)}
			{#each week as d, di (d?.date ?? `pad-${wi}-${di}`)}
				{#if !d}
					<span aria-hidden="true"></span>
				{:else}
					{@const ok = pickable(d, model)}
					{@const on = d.date === value}
					{@const word = cellWord(d, model)}
					<button
						type="button"
						data-date={d.date}
						aria-pressed={on}
						aria-disabled={!ok}
						aria-label={ariaOf(d)}
						tabindex={on || (!value && d === list.find((x) => pickable(x, model))) ? 0 : -1}
						class={[
							'relative flex h-14 min-w-0 flex-col items-center justify-start rounded-md border pt-1 text-center outline-offset-1 transition-colors focus-visible:outline-2 focus-visible:outline-accent',
							on
								? 'border-accent bg-accent text-sheet'
								: ok
									? 'border-rule-strong bg-sheet text-ink hover:border-accent'
									: d.status === 'holiday'
										? 'border-out/40 bg-out-wash/50 text-ink-2'
										: 'border-transparent bg-well/60 text-ink-3',
							!ok && 'cursor-default'
						]}
						onclick={() => pick(d)}
						onkeydown={(e) => onKey(e, list)}
						onfocus={() => (focusDate = d.date)}
						onblur={() => (focusDate = null)}
						onmouseenter={() => (focusDate = d.date)}
						onmouseleave={() => (focusDate = null)}
					>
						<span class="mono text-body leading-5 font-medium">{Number(d.date.slice(8))}</span>
						{#if word}
							<span
								class={[
									'text-micro leading-3',
									on
										? 'text-sheet'
										: word === 'Stock'
											? 'text-signoff'
											: word === 'Holiday'
												? 'text-out'
												: 'text-ink-3'
								]}>{word}</span
							>
						{/if}
						<span class="mt-auto mb-1 flex h-3 items-center gap-0.5" aria-hidden="true">
							{#each iconsOf(d) as { kind, Icon } (kind)}
								<Icon size={11} strokeWidth={2.25} />
							{/each}
						</span>
					</button>
				{/if}
			{/each}
		{/each}
	</div>
{/snippet}

<div class="w-full max-w-[400px] text-body text-ink">
	<div class="mb-1.5 flex items-baseline justify-between gap-2">
		<span class="text-meta font-medium text-ink-2" id="daypicker-label-{kitchenId}">{label}</span>
		<Popover.Root open={later.open} onOpenChange={openLater}>
			<Popover.Trigger
				class="inline-flex items-center gap-1 text-meta text-accent-ink hover:underline"
				aria-label="Pick a later day"
			>
				<CalendarDays size={13} aria-hidden="true" />Later…
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					sideOffset={6}
					align="end"
					class="z-50 w-[min(360px,calc(100vw-24px))] rounded-lg border border-rule bg-sheet p-3 shadow-lg"
				>
					<div class="mb-2 flex items-center justify-between">
						<button
							type="button"
							class="rounded p-1 text-ink-2 hover:bg-well hover:text-ink"
							aria-label="Previous month"
							onclick={() => loadMonth(shiftMonth(later.month, -1))}
							><ChevronLeft size={16} /></button
						>
						<span class="text-body font-medium" aria-live="polite"
							>{later.month ? monthName(later.month) : ''}</span
						>
						<button
							type="button"
							class="rounded p-1 text-ink-2 hover:bg-well hover:text-ink"
							aria-label="Next month"
							onclick={() => loadMonth(shiftMonth(later.month, 1))}
							><ChevronRight size={16} /></button
						>
					</div>
					{#if later.loading && !later.days.length}
						<p class="py-8 text-center text-meta text-ink-3">Loading…</p>
					{:else if later.days.length}
						{@render grid(
							later.days,
							weeksOf(later.days),
							later.month ? monthName(later.month) : 'Month'
						)}
					{:else}
						<p class="py-8 text-center text-meta text-ink-3">No days for this month.</p>
					{/if}
					<p class="mt-2 min-h-8 text-meta text-ink-2" aria-live="polite">
						{#if focusDate && later.days.find((d) => d.date === focusDate)}
							{daySentence(
								later.days.find((d) => d.date === focusDate)!,
								model
							)}
						{:else}
							Pick a day with a delivery; grey days have none.
						{/if}
					</p>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	</div>

	{#if failed}
		<p class="rounded-md border border-rule p-3 text-meta text-ink-2">
			The calendar didn't load. Delivery dates can still be typed where the order is made.
		</p>
	{:else if !days.length}
		<div class="h-[196px] animate-pulse rounded-md bg-well/60" aria-label="Loading days"></div>
	{:else}
		{@render grid(days, weeks, `${label}: the next three weeks`)}
	{/if}

	<div class="mt-2 min-h-10 text-meta" aria-live="polite">
		{#if shown}
			<p class="text-ink">{daySentence(shown, model)}</p>
			{#if shown.marks.length}
				<ul class="mt-1 flex flex-col gap-0.5 text-ink-2">
					{#each shown.marks as m, i (i)}
						{@const Icon = ICONS[m.kind]}
						<li class="flex items-start gap-1.5">
							<Icon size={12} class="mt-0.5 shrink-0" aria-hidden="true" />
							<span>{markLine(m)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if valueOutside && value}
			<p class="text-ink">Picked {dayLabel(value)}.</p>
		{:else if days.length}
			<p class="text-ink-2">
				Pick a day. White days can still be ordered; grey days have no delivery.
			</p>
		{/if}
	</div>
</div>
