<script lang="ts">
	/**
	 * A kitchen's usual order for one delivery day (D14), read from its simulated history: the lines that usually
	 * come that day, what joined and dropped, and "Plan this order". A suggestion until the chef plans it; planning
	 * goes through place_order as the chef, so the mandate decides what is ordered alone. Self-contained: it reads
	 * and plans through /kitchen-api/usual.
	 */
	import {
		CircleCheck,
		CircleDashed,
		CircleMinus,
		History,
		Plus,
		Search,
		Sparkles,
		X,
		ArrowRight,
		ChevronRight
	} from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { day, money, num, readableName } from './format';
	import type { UsualSummary } from './usual';
	import { salesUnitWords, unitWord } from './request/words';

	interface Props {
		kitchenId: string;
		/** Delivery day (YYYY-MM-DD); default the kitchen's next receiving day after the sim's today. */
		date?: string;
		/** Where it reads and plans; default /kitchen-api/usual. */
		endpoint?: string;
		/** After a plan was made: its id and state (the page may open it with /?plan=<id>). */
		onplanned?: (r: { planId: string; state: string; approvalId: string | null }) => void;
		/** What the usual order comes to as read and edited, for a headline outside the card. */
		onsummary?: (s: UsualSummary | null) => void;
		/** The card's own "Plan this order" is the zone's primary; false when a headline outside owns it. */
		primary?: boolean;
	}
	let {
		kitchenId,
		date,
		endpoint = '/kitchen-api/usual',
		onplanned,
		onsummary,
		primary = true
	}: Props = $props();

	type Status = 'settled' | 'forming' | 'joined' | 'dropped' | 'not_settled';
	interface Line {
		productId: string;
		name: string;
		/** The catalogue's English name, when it differs. */
		nameEn?: string;
		unit: string;
		lotStep: number;
		qty: number;
		low: number;
		high: number;
		status: Status;
		sentence: string;
		rhythm: string;
		unitCents: number | null;
		source: 'detected' | 'override';
	}
	interface Change {
		productId: string;
		name: string;
		nameEn?: string;
		unit: string;
		qty: number;
		dueOnDay: boolean;
		sentence: string;
	}
	interface Usual {
		label: string;
		kitchenName: string;
		deliveryDate: string;
		weekday: string;
		sentence: string;
		settled: boolean;
		lines: Line[];
		joined: Change[];
		dropped: Change[];
		notSettled: Change[];
		/** English names by product id, when they differ from the Finnish ones. */
		englishNames?: Record<string, string>;
	}
	interface Row {
		productId: string;
		name: string;
		nameEn?: string;
		unit: string;
		lotStep: number;
		qty: number;
		on: boolean;
		unitCents: number | null;
		kind: 'usual' | 'topup';
	}
	interface Hit {
		productId: string;
		name: string;
		nameEn?: string;
		unit: string;
		lotStep: number;
	}

	const WINDOWS = [
		{ v: '4w', label: '4 weeks' },
		{ v: '8w', label: '8 weeks' },
		{ v: '12w', label: '12 weeks' },
		{ v: '3m', label: '3 months' },
		{ v: '6m', label: '6 months' }
	];
	const EVERY = [
		{ v: '', label: 'as detected' },
		{ v: '1w', label: 'every week' },
		{ v: '2w', label: 'every 2 weeks' },
		{ v: '4w', label: 'every 4 weeks' },
		{ v: '1m', label: 'every month' }
	];
	const DAY_NAMES: Record<string, string> = {
		mon: 'Monday',
		tue: 'Tuesday',
		wed: 'Wednesday',
		thu: 'Thursday',
		fri: 'Friday',
		sat: 'Saturday',
		sun: 'Sunday'
	};

	let windowV = $state('12w');
	/** Per-product "every …" chosen in this session only; sent with each read, never stored. */
	let every = $state<Record<string, string>>({});
	let data = $state.raw<Usual | null>(null);
	let loadError = $state<string | null>(null);
	let loading = $state(false);
	/** The chef's edits by product: quantity and tick. Kept across re-reads. */
	let edits = $state<Record<string, { qty: number; on: boolean }>>({});
	let topups = $state<Row[]>([]);
	let query = $state('');
	let hits = $state.raw<Hit[]>([]);
	let planning = $state(false);
	let planned = $state<{ planId: string; state: string; summary: string | null } | null>(null);
	let planError = $state<string | null>(null);

	function url() {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and read once per request
		const p = new URLSearchParams({ kitchen: kitchenId, window: windowV });
		if (date) p.set('date', date);
		for (const [id, v] of Object.entries(every)) if (v) p.append('every', `${id}:${v}`);
		return `${endpoint}?${p}`;
	}

	async function load() {
		loading = true;
		loadError = null;
		try {
			const r = await fetch(url());
			if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
			data = (await r.json()) as Usual;
			planned = null;
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		// Re-read when the kitchen, day, window or a session override changes.
		void [kitchenId, date, windowV, JSON.stringify(every)];
		load();
	});

	/** A product's English name, a muted second line under the Finnish one; only when it says something else. */
	function englishOf(productId: string, name: string): string | undefined {
		const en =
			data?.englishNames?.[productId] ??
			[
				...(data?.lines ?? []),
				...(data?.joined ?? []),
				...(data?.dropped ?? []),
				...(data?.notSettled ?? []),
				...topups
			].find((l) => l.productId === productId && l.nameEn)?.nameEn;
		return en?.trim() && en.trim().toLowerCase() !== readableName(name).toLowerCase()
			? readableName(en.trim())
			: undefined;
	}
	const rows = $derived.by<Row[]>(() => {
		const usual: Row[] = (data?.lines ?? []).map((l) => ({
			productId: l.productId,
			name: l.name,
			unit: l.unit,
			lotStep: l.lotStep,
			qty: edits[l.productId]?.qty ?? l.qty,
			on: edits[l.productId]?.on ?? true,
			unitCents: l.unitCents,
			kind: 'usual'
		}));
		const have = new Set(usual.map((r) => r.productId));
		return [...usual, ...topups.filter((t) => !have.has(t.productId))];
	});
	const chosen = $derived(rows.filter((r) => r.on && r.qty > 0));
	const total = $derived(chosen.reduce((n, r) => n + (r.unitCents ?? 0) * r.qty, 0));
	const unpriced = $derived(chosen.filter((r) => r.unitCents === null).length);
	/** "packs" / "pack" / "kg": the unit words without the number. */
	const unitsOnly = (q: number, unit: string) => salesUnitWords(q, unit).replace(/^[\d.,\s]+/, '');
	const lineOf = (id: string) => data?.lines.find((l) => l.productId === id);
	/** The sentence without the title it repeats: "From 12 weeks of history: 4 lines, 3 settled." */
	const subline = $derived.by(() => {
		if (!data) return 'Reading the order history…';
		const rest = data.sentence.replace(/^Usual \w+ order from /, '');
		return rest === data.sentence ? rest : `From ${rest}`;
	});
	$effect(() => {
		onsummary?.(
			data && rows.length
				? {
						weekday: DAY_NAMES[data.weekday] ?? '',
						deliveryDate: data.deliveryDate,
						lines: chosen.length,
						cents: total,
						unpriced,
						planning,
						planned: !!planned
					}
				: null
		);
	});
	/** Which rows show their history (how settled, the usual range, the rhythm). */
	let openRow = $state<Record<string, boolean>>({});
	const title = $derived(data ? `Usual ${DAY_NAMES[data.weekday] ?? ''} order` : 'Usual order');

	function setQty(id: string, v: number, on = true) {
		edits = { ...edits, [id]: { qty: Math.max(0, v), on } };
		const t = topups.find((x) => x.productId === id);
		if (t) topups = topups.map((x) => (x.productId === id ? { ...x, qty: Math.max(0, v), on } : x));
	}
	function toggle(r: Row) {
		if (r.kind === 'topup') {
			topups = topups.map((x) => (x.productId === r.productId ? { ...x, on: !x.on } : x));
			return;
		}
		edits = { ...edits, [r.productId]: { qty: r.qty, on: !r.on } };
	}
	function addTopUp(
		h: { productId: string; name: string; nameEn?: string; unit: string; lotStep?: number },
		qty?: number
	) {
		if (rows.some((r) => r.productId === h.productId)) return;
		const step = h.lotStep && h.lotStep >= 1 ? h.lotStep : 1;
		topups = [
			...topups,
			{
				productId: h.productId,
				name: h.name,
				...(h.nameEn ? { nameEn: h.nameEn } : {}),
				unit: h.unit,
				lotStep: step,
				qty: qty ?? step,
				on: true,
				unitCents: null,
				kind: 'topup'
			}
		];
		query = '';
		hits = [];
	}

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function onSearch() {
		clearTimeout(searchTimer);
		const q = query.trim();
		if (q.length < 2) {
			hits = [];
			return;
		}
		searchTimer = setTimeout(async () => {
			const r = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`);
			if (r.ok) hits = ((await r.json()) as { hits: Hit[] }).hits;
		}, 250);
	}

	/** Plan the order as read and edited; a headline outside the card calls it through `bind:this`. */
	export async function plan() {
		if (!data || !chosen.length) return;
		planning = true;
		planError = null;
		try {
			const r = await fetch(endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					kitchenId,
					deliveryDate: data.deliveryDate,
					lines: chosen.map((x) => ({ productId: x.productId, qty: x.qty, unit: x.unit }))
				})
			});
			const body = await r.json();
			if (!r.ok) throw new Error(body?.error?.message ?? `HTTP ${r.status}`);
			planned = { planId: body.planId, state: body.state, summary: body.summary };
			onplanned?.({ planId: body.planId, state: body.state, approvalId: body.approvalId });
		} catch (e) {
			planError = e instanceof Error ? e.message : String(e);
		} finally {
			planning = false;
		}
	}

	const STATE_WORDS: Record<string, string> = {
		draft: 'drafted',
		quoted: 'priced',
		held: 'waiting on your decisions',
		ready: 'ready to order',
		committed: 'ordered'
	};
	const STATUS = {
		settled: { word: 'Settled', icon: CircleCheck, cls: 'text-ok' },
		forming: { word: 'Forming', icon: CircleDashed, cls: 'text-signoff' },
		joined: { word: 'Joined', icon: Sparkles, cls: 'text-accent' },
		dropped: { word: 'Dropped', icon: CircleMinus, cls: 'text-ink-3' },
		not_settled: { word: 'Not settled', icon: CircleDashed, cls: 'text-ink-3' }
	} as const;
</script>

{#if data && !data.settled && !topups.length && !data.lines.length}
	<!-- No history yet: no empty card, one line that says when it will appear. -->
	<p class="text-meta text-ink-3">Your usual order appears here after a few weeks of orders.</p>
{:else}
	<section class="rounded-lg border border-rule bg-sheet text-ink" aria-busy={loading}>
		<header
			class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-rule p-4"
		>
			<div class="min-w-0">
				<h2 class="text-title font-semibold">
					{title}{#if data}<span class="font-normal text-ink-2"
							>{` · ${day(data.deliveryDate)}`}</span
						>{/if}
				</h2>
				<p class="mt-1 text-body text-ink-2">{subline}</p>
			</div>
			<span
				class="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-rule-strong px-2 py-0.5 text-meta text-ink-2"
				title="Generated from the kitchen's profile: there is no real order history yet"
			>
				<History size={14} aria-hidden="true" /> Simulated history
			</span>
		</header>

		<div
			class="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2 text-meta text-ink-2"
		>
			<label class="flex items-center gap-1.5">
				Read the last
				<select
					class="rounded-md border border-rule bg-sheet px-1.5 py-1 text-meta text-ink"
					bind:value={windowV}
				>
					{#each WINDOWS as w (w.v)}<option value={w.v}>{w.label}</option>{/each}
				</select>
			</label>
			{#if Object.values(every).some(Boolean)}
				<button
					class="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-well"
					onclick={() => (every = {})}
				>
					<X size={13} aria-hidden="true" /> Clear rhythm changes
				</button>
			{/if}
		</div>

		{#if loadError}
			<p class="p-4 text-body text-out">Couldn't read the usual order. {loadError}</p>
		{:else if data && !data.settled}
			<p class="p-4 text-body text-ink-2">
				Too little history to call anything usual yet. Order as you go; patterns show after about
				four weeks.
			</p>
		{/if}

		{#if rows.length}
			<ul class="divide-y divide-rule">
				{#each rows as r (r.productId)}
					{@const l = lineOf(r.productId)}
					{@const st = l ? STATUS[l.status] : null}
					<li class="px-4 py-2">
						<div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3">
							<input
								type="checkbox"
								class="size-4 accent-[var(--color-accent)]"
								checked={r.on}
								onchange={() => toggle(r)}
								aria-label={`Include ${readableName(r.name)}`}
							/>
							<div class="min-w-0">
								<button
									type="button"
									class="flex w-full min-w-0 items-baseline gap-1.5 text-left text-body break-words {r.on
										? 'text-ink'
										: 'text-ink-3 line-through'}"
									aria-expanded={l ? !!openRow[r.productId] : undefined}
									disabled={!l}
									onclick={() => (openRow = { ...openRow, [r.productId]: !openRow[r.productId] })}
								>
									{#if l}<ChevronRight
											size={13}
											class="shrink-0 translate-y-0.5 text-ink-3 transition-transform {openRow[
												r.productId
											]
												? 'rotate-90'
												: ''}"
											aria-hidden="true"
										/>{/if}
									<span class="min-w-0"
										>{readableName(r.name)}{#if englishOf(r.productId, r.name)}<span
												class="block truncate text-meta text-ink-3"
												>{englishOf(r.productId, r.name)}</span
											>{/if}</span
									>
								</button>
								{#if st}
									{@const Icon = st.icon}
									<span class="ml-5 inline-flex items-center gap-1 text-meta {st.cls}">
										<Icon size={12} aria-hidden="true" />{st.word}
									</span>
								{:else}
									<span class="inline-flex items-center gap-1 text-meta text-accent">
										<Plus size={12} aria-hidden="true" />Top-up for this order
									</span>
								{/if}
							</div>
							<div class="flex flex-col items-end gap-0.5">
								<label class="flex items-center gap-1.5 text-meta text-ink-2">
									<input
										type="number"
										inputmode="decimal"
										min="0"
										step={r.lotStep}
										class="mono w-14 rounded-md border border-rule bg-sheet px-1.5 py-0.5 text-right text-body text-ink"
										value={r.qty}
										onchange={(e) =>
											setQty(
												r.productId,
												Number((e.currentTarget as HTMLInputElement).value),
												r.on
											)}
										aria-label={`Quantity of ${readableName(r.name)}`}
									/>
									<span class="whitespace-nowrap">{unitsOnly(r.qty, r.unit)}</span>
								</label>
								{#if r.unitCents === null}
									<span class="text-meta whitespace-nowrap text-ink-3">priced when planned</span>
								{:else}
									<span
										class="mono text-right text-meta tabular-nums {r.on
											? 'text-ink'
											: 'text-ink-3'}">{money(r.unitCents * r.qty)}</span
									>
								{/if}
							</div>
						</div>
						{#if l && openRow[r.productId]}
							<div class="mt-1 ml-7 flex flex-col gap-1 text-meta text-ink-2">
								<span
									>{l.sentence}{#if l.low !== l.high}<span class="text-ink-3">
											· usually {num(l.low)}–{num(l.high)}</span
										>{/if}</span
								>
								<label class="inline-flex items-center gap-1 text-micro text-ink-3">
									Rhythm
									<select
										class="rounded border border-rule bg-sheet px-1 py-0.5 text-micro text-ink-2"
										value={every[r.productId] ?? ''}
										onchange={(e) =>
											(every = {
												...every,
												[r.productId]: (e.currentTarget as HTMLSelectElement).value
											})}
									>
										{#each EVERY as o (o.v)}<option value={o.v}>{o.label}</option>{/each}
									</select>
									{#if every[r.productId]}<span>· this session only</span>{/if}
								</label>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{:else if data?.settled}
			<p class="p-4 text-body text-ink-2">Nothing usually comes this day. Add a top-up below.</p>
		{/if}

		{#if data && (data.joined.length || data.dropped.length)}
			<div class="grid gap-3 border-t border-rule px-4 py-3 sm:grid-cols-2">
				{#if data.joined.length}
					<div>
						<h3 class="flex items-center gap-1 text-heading font-medium text-accent">
							<Sparkles size={15} aria-hidden="true" /> Joined recently
						</h3>
						<ul class="mt-1 space-y-1.5">
							{#each data.joined as c (c.productId)}
								<li class="text-meta">
									<span class="text-body text-ink">{readableName(c.name)}</span>
									{#if englishOf(c.productId, c.name)}<span class="block truncate text-ink-3"
											>{englishOf(c.productId, c.name)}</span
										>{/if}
									<span class="block text-ink-2">{c.sentence}</span>
									{#if !rows.some((r) => r.productId === c.productId)}
										<button
											class="mt-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-accent-ink hover:bg-accent-wash"
											onclick={() => addTopUp(c, c.qty)}
										>
											<Plus size={13} aria-hidden="true" /> Add {salesUnitWords(
												c.qty,
												c.unit
											)}{c.dueOnDay ? ' (due this day)' : ''}
										</button>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if data.dropped.length}
					<div>
						<h3 class="flex items-center gap-1 text-heading font-medium text-ink-2">
							<CircleMinus size={15} aria-hidden="true" /> Dropped out
						</h3>
						<ul class="mt-1 space-y-1.5">
							{#each data.dropped as c (c.productId)}
								<li class="text-meta">
									<span class="text-body text-ink">{readableName(c.name)}</span>
									{#if englishOf(c.productId, c.name)}<span class="block truncate text-ink-3"
											>{englishOf(c.productId, c.name)}</span
										>{/if}
									<span class="block text-ink-2">{c.sentence}</span>
									{#if !rows.some((r) => r.productId === c.productId)}
										<button
											class="mt-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ink-2 hover:bg-well"
											onclick={() => addTopUp(c, c.qty)}
										>
											<Plus size={13} aria-hidden="true" /> Add back
										</button>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/if}

		<div class="relative border-t border-rule px-4 py-3">
			<label
				class="flex items-center gap-2 rounded-md border border-rule bg-sheet px-2 py-1.5 text-body"
			>
				<Search size={15} class="text-ink-3" aria-hidden="true" />
				<input
					class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3"
					placeholder="Add a top-up: search products"
					bind:value={query}
					oninput={onSearch}
				/>
			</label>
			{#if hits.length}
				<ul
					class="absolute inset-x-4 z-10 mt-1 max-h-64 overflow-auto rounded-md border border-rule bg-sheet shadow-lg"
				>
					{#each hits as h (h.productId)}
						<li>
							<button
								class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-body hover:bg-well"
								onclick={() => addTopUp(h)}
							>
								<span class="min-w-0 truncate" title={h.nameEn ? readableName(h.nameEn) : undefined}
									>{readableName(h.name)}{#if h.nameEn}<span class="text-ink-3">
											· {readableName(h.nameEn)}</span
										>{/if}</span
								>
								<span class="shrink-0 text-meta text-ink-3">per {unitWord(h.unit)}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<footer
			class="flex flex-wrap items-center justify-between gap-3 border-t border-rule bg-well/50 px-4 py-3"
		>
			<div class="text-body">
				<span class="font-semibold">{chosen.length} {chosen.length === 1 ? 'line' : 'lines'}</span>
				<span class="mono"> · {money(total, { whole: true })}</span>
				{#if unpriced}<span class="text-meta text-ink-3">
						+ {unpriced} priced when planned</span
					>{/if}
				<p class="text-meta text-ink-3">
					A suggestion until you plan it. Your mandate decides what is ordered alone.
				</p>
			</div>
			{#if planned}
				<!-- eslint-disable svelte/no-navigation-without-resolve -- kitchen deep link with a query, built from resolve('/') -->
				<a
					class="inline-flex items-center gap-1.5 rounded-md bg-ok-wash px-3 py-2 text-body text-ok"
					href={`${resolve('/')}?plan=${encodeURIComponent(planned.planId)}`}
				>
					<CircleCheck size={16} aria-hidden="true" /> Planned, {STATE_WORDS[planned.state] ??
						planned.state}: open it
					<ArrowRight size={15} aria-hidden="true" />
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{:else if primary}
				<button
					class="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-body font-medium disabled:opacity-50 {primary
						? 'bg-accent text-sheet'
						: 'border border-rule-strong text-ink hover:border-accent'}"
					disabled={planning || !chosen.length || !data}
					onclick={plan}
				>
					{planning ? 'Planning…' : 'Plan this order'}
				</button>
			{/if}
			{#if planError}<p class="w-full text-meta text-out">Not planned: {planError}</p>{/if}
		</footer>
	</section>
{/if}
