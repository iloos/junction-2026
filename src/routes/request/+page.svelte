<script lang="ts">
	import {
		ArrowRight,
		RotateCcw,
		TriangleAlert,
		Check,
		Repeat,
		Info,
		LoaderCircle
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { Plan } from '$lib/core/contracts';

	import SourceTag from '$lib/ui/SourceTag.svelte';
	import StateChip from '$lib/ui/StateChip.svelte';
	import { day, money, num, shortHash, storyTime } from '$lib/ui/format';
	import { useShell } from '$lib/ui/shell/shell.svelte';
	import Step from '$lib/ui/request/Step.svelte';
	import Answer from '$lib/ui/request/Answer.svelte';
	import BriefAsk from '$lib/ui/request/BriefAsk.svelte';
	import MenuReview from '$lib/ui/request/MenuReview.svelte';
	import type {
		ApprovalView,
		BriefAnswer,
		BriefDraft,
		CommitView,
		EventView,
		LookupView,
		MenuChange,
		MenuPlanResult,
		MenuView,
		OrderView,
		ParsedView,
		RequestEvent,
		RequestAnswer,
		RequestResult
	} from '$lib/ui/request/types';
	import {
		CONSTRAINT_WORDS,
		APPROVAL_STATE_WORDS,
		offerSourceWords,
		quantityWords,
		reasonWords,
		unitWord,
		TIER_WORDS,
		tierWords,
		UNIT_WORDS
	} from '$lib/ui/request/words';
	import { availText } from '$lib/kitchen/live-view';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const EXAMPLES = [
		'1,000 L lactose-free milk by Monday',
		'200 kg potatoes Friday',
		'2 cases of butter Thursday'
	];
	const PLACEHOLDER = EXAMPLES[0];

	type Status = 'idle' | 'running' | 'done' | 'warn' | 'blocked' | 'error';
	let text = $state('');
	let kitchenId = $state('');
	$effect.pre(() => {
		if (!kitchenId) kitchenId = data.defaultKitchen;
	});
	const newNonce = () => (crypto.randomUUID?.() ?? String(Math.random())).slice(0, 12);
	let nonce = $state(newNonce());
	/** Inline answers to the current request's questions; new words start without them. */
	let answers = $state.raw<RequestAnswer[]>([]);
	/** Answers to the event brief's questions, by question id; new words start without them. */
	let briefAnswers = $state.raw<BriefAnswer[]>([]);
	let busy = $state(false);
	/** Until hydration the form would submit natively and lose the text. */
	let ready = $state(false);
	onMount(() => (ready = true));
	let error = $state<string | null>(null);

	let status = $state<Record<'request' | 'lookup' | 'order' | 'approval', Status>>({
		request: 'idle',
		lookup: 'idle',
		order: 'idle',
		approval: 'idle'
	});
	let ms = $state<Record<string, number | null>>({});
	let parsed = $state.raw<ParsedView | null>(null);
	let lookup = $state.raw<LookupView | null>(null);
	let order = $state.raw<OrderView | null>(null);
	let plan = $state.raw<Plan | null>(null);
	let approval = $state.raw<ApprovalView | null>(null);
	let commits = $state.raw<CommitView[]>([]);
	let resultMessage = $state<string | null>(null);
	/** Set when the words were an event brief: nothing was searched. */
	let event = $state.raw<EventView | null>(null);
	/** The last run stopped before placing because the order is unusually large. */
	let needsConfirm = $state(false);

	const kitchen = $derived(data.kitchens.find((k) => k.id === kitchenId) ?? data.kitchens[0]);
	const names = $derived(
		new Map(
			(lookup?.items ?? []).flatMap((i) => i.shortlist.map((c) => [c.productId, c.name] as const))
		)
	);
	const caps = $derived(order?.kitchen ?? kitchen);
	const committed = $derived(commits[0] ?? null);
	const canCommit = $derived(
		!!plan &&
			!committed &&
			(approval?.state === 'granted' ||
				(!approval && plan.lines.some((l) => l.state === 'eligible' && l.tier === 'act')))
	);

	function reset() {
		status = { request: 'idle', lookup: 'idle', order: 'idle', approval: 'idle' };
		ms = {};
		parsed = lookup = order = plan = approval = null;
		commits = [];
		error = resultMessage = null;
		needsConfirm = false;
		event = null;
		menu = null;
		menuPlan = null;
	}

	function approvalStatus(): Status {
		if (commits.length || approval?.state === 'granted') return 'done';
		if (!plan) return 'idle';
		if (!approval && plan.lines.some((l) => l.reasons.includes('over_hard_limit'))) return 'error';
		if (
			approval?.state === 'denied' ||
			approval?.state === 'invalidated' ||
			approval?.state === 'expired'
		)
			return 'warn';
		return 'blocked';
	}

	function apply(e: RequestEvent | { step: 'result'; data: RequestResult }) {
		if (e.step === 'result') {
			resultMessage = e.data.message ?? null;
			needsConfirm = e.data.needsConfirm === true;
			event = e.data.event ?? null;
			// A complete brief goes straight to a menu proposal: the chef reviews it next.
			if (event?.draft && !event.question) void propose();
			if (status.lookup === 'running') status.lookup = 'idle';
			if (status.order === 'running') status.order = 'idle';
			return;
		}
		if (e.step === 'error') {
			error = e.message;
			for (const k of ['request', 'lookup', 'order'] as const)
				if (status[k] === 'running') status[k] = 'error';
			return;
		}
		ms[e.step] = e.ms;
		status[e.step] = e.status;
		if (e.step === 'request') {
			parsed = e.data;
			if (e.status !== 'blocked') status.lookup = 'running';
		} else if (e.step === 'lookup') {
			lookup = e.data;
			if (e.status !== 'blocked') status.order = 'running';
		} else if (e.step === 'order') {
			order = e.data;
			plan = e.data?.plan ?? null;
			approval = e.data?.approval ?? null;
			if (!e.data) error = e.message ?? 'place_order failed';
			status.approval = approvalStatus();
		}
	}

	async function submit(t = text, keepAnswers = false, confirmLarge = false) {
		const req = t.trim() || PLACEHOLDER;
		if (!keepAnswers || req !== text) {
			answers = [];
			briefAnswers = [];
			deliverBy = null;
		}
		text = req;
		reset();
		busy = true;
		status.request = 'running';
		try {
			const res = await fetch('/request/run', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					text: req,
					kitchenId,
					nonce,
					answers,
					briefAnswers,
					confirmLarge,
					...(deliverBy ? { deliverBy } : {})
				})
			});
			if (!res.ok || !res.body) {
				const b = await res.json().catch(() => null);
				throw new Error(b?.error?.message ?? `HTTP ${res.status}`);
			}
			const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
			let buf = '';
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buf += value;
				let nl;
				while ((nl = buf.indexOf('\n')) >= 0) {
					const line = buf.slice(0, nl).trim();
					buf = buf.slice(nl + 1);
					if (line) apply(JSON.parse(line));
				}
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			status.request = status.request === 'running' ? 'error' : status.request;
		} finally {
			busy = false;
		}
	}

	async function post<T>(body: Record<string, unknown>): Promise<T> {
		const res = await fetch('/request/run', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const b = await res.json();
		if (!res.ok)
			throw new Error(b?.error ? `${b.error.code}: ${b.error.message}` : `HTTP ${res.status}`);
		return b as T;
	}

	/**
	 * Once the chef approved or committed, the earlier steps' cautions were part of the terms accepted: their
	 * "check" marks turn done. A step that needs an answer or failed keeps its mark.
	 */
	function settle() {
		if (approval?.state !== 'granted' && !commits.length) return;
		for (const k of ['request', 'lookup', 'order'] as const)
			if (status[k] === 'warn') status[k] = 'done';
	}

	/**
	 * Who did what to the order, in D10 words: the agent prepares; only a receipt makes it placed (simulated), and
	 * until then the line says what it waits for.
	 */
	function orderStatusWords(): string {
		const k = order?.kitchen.name ?? '';
		if (committed) return `Placed for ${k} (simulated) · receipt ${committed.receiptId}`;
		const prepared = `Prepared by the kitchen agent for ${k}`;
		if (approval?.state === 'pending') return `${prepared} · waiting for your approval`;
		if (approval?.state === 'granted') return `${prepared} · approved, not placed yet`;
		if (approval?.state === 'denied') return `${prepared} · denied, nothing placed`;
		if (approval)
			return `${prepared} · approval ${APPROVAL_STATE_WORDS[approval.state]?.toLowerCase() ?? approval.state}, nothing placed`;
		if (plan?.lines.some((l) => l.reasons.includes('over_hard_limit')))
			return `${prepared} · over the hard limit, nothing can be placed`;
		if (plan?.lines.every((l) => l.state === 'eligible' && l.tier === 'act'))
			return `${prepared} · within your mandate, not placed yet`;
		return `${prepared} · held, nothing placed`;
	}

	async function decide(decision: 'grant' | 'deny') {
		if (!approval || !plan) return;
		busy = true;
		error = null;
		try {
			const r = await post<{ state: string; plan: Plan; approval: ApprovalView | null }>({
				action: 'approve',
				decision,
				approvalId: approval.id,
				planId: plan.id,
				planVersion: approval.planVersion,
				termsHash: approval.termsHash
			});
			plan = r.plan;
			approval = r.approval ?? { ...approval, state: r.state };
			status.approval = approvalStatus();
			settle();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function commit() {
		if (!plan) return;
		busy = true;
		error = null;
		const version = committed ? commits.at(-1)!.version : plan.version;
		try {
			const r = await post<{ commit: CommitView; plan: Plan; approval: ApprovalView | null }>({
				action: 'commit',
				planId: plan.id,
				version,
				attempt: commits.length + 1
			});
			commits = [...commits, r.commit];
			plan = r.plan;
			if (r.approval) approval = r.approval;
			status.approval = approvalStatus();
			settle();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	/** Answer one item's question in place and run the same words again with every answer so far. */
	function answer(a: RequestAnswer) {
		answers = [...answers.filter((x) => x.item !== a.item), a];
		submit(text, true);
	}

	function answerText(a: RequestAnswer): string {
		const item = parsed?.items.find((i) => i.id === a.item);
		const what = item?.product ?? item?.query ?? a.item;
		const parts = [
			a.qty !== undefined ? `${num(a.qty, 3)} ${a.unit ? (UNIT_WORDS[a.unit] ?? a.unit) : ''}` : '',
			a.productId ? `product ${a.productId}` : ''
		].filter(Boolean);
		return `${what}: ${parts.join(', ')}`;
	}

	/** The menu proposed from a complete brief, and where planning it stands. */
	let menu = $state.raw<MenuView | null>(null);
	let menuPlan = $state.raw<MenuPlanResult | null>(null);
	let menuBusy = $state(false);

	async function menuCall<T>(body: Record<string, unknown>): Promise<T | null> {
		menuBusy = true;
		error = null;
		try {
			const res = await fetch('/request/menu', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const b = await res.json();
			if (!res.ok)
				throw new Error(b?.error ? `${b.error.code}: ${b.error.message}` : `HTTP ${res.status}`);
			return b as T;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			return null;
		} finally {
			menuBusy = false;
		}
	}
	/** Where proposing stands, from the server's progress lines: brief → dishes → products. */
	let proposing = $state.raw<{
		dishes: string[] | null;
		source: 'llm' | 'templates' | null;
		done: number;
		total: number;
	} | null>(null);
	async function propose() {
		menuBusy = true;
		error = null;
		proposing = { dishes: null, source: null, done: 0, total: 0 };
		try {
			const res = await fetch('/request/menu', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'propose', text, kitchenId, briefAnswers, nonce })
			});
			if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
			const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
			let buf = '';
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buf += value;
				let nl;
				while ((nl = buf.indexOf('\n')) >= 0) {
					const line = buf.slice(0, nl).trim();
					buf = buf.slice(nl + 1);
					if (!line) continue;
					const m = JSON.parse(line);
					if (m.progress?.step === 'dishes')
						proposing = { ...proposing!, dishes: m.progress.dishes, source: m.progress.source };
					else if (m.progress?.step === 'products')
						proposing = { ...proposing!, done: m.progress.done, total: m.progress.total };
					else if (m.result) menu = m.result as MenuView;
					else if (m.error) throw new Error(`${m.error.code}: ${m.error.message}`);
				}
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			menuBusy = false;
			proposing = null;
		}
	}
	async function editMenu(changes: MenuChange[]) {
		if (!menu) return;
		const r = await menuCall<MenuView>({
			action: 'edit',
			id: menu.proposal.id,
			revision: menu.proposal.revision,
			changes
		});
		if (r) menu = r;
	}
	async function acceptMenu() {
		if (!menu) return;
		const r = await menuCall<MenuView>({
			action: 'accept',
			id: menu.proposal.id,
			revision: menu.proposal.revision
		});
		if (r) menu = r;
	}
	async function planMenu() {
		if (!menu) return;
		menuPlan = await menuCall<MenuPlanResult>({
			action: 'plan',
			id: menu.proposal.id,
			revision: menu.proposal.revision
		});
		// The event is planned: request, lookup, order and approval are all answered by the plan in the Kitchen.
		if (menuPlan) status = { request: 'done', lookup: 'done', order: 'done', approval: 'done' };
	}

	/** The chef took the first open delivery date after a cut-off: same words, that date, said in the notes. */
	let deliverBy = $state<string | null>(null);
	function chooseDate(date: string) {
		deliverBy = date;
		submit(text, true);
	}

	/** Answer the brief's open question and run the same words again with every brief answer so far. */
	function answerBrief(a: BriefAnswer) {
		briefAnswers = [...briefAnswers.filter((x) => x.id !== a.id), a];
		submit(text, true);
	}

	const STYLE_LABEL: Record<string, string> = {
		buffet: 'Buffet',
		plated: 'Plated',
		family: 'Family style',
		canape: 'Canapés',
		lunch: 'Lunch'
	};
	/** The brief's fields as rows: label, value (null = still to ask) and where it came from. */
	function briefRows(b: BriefDraft): [string, string | null, string | undefined][] {
		return [
			['Guests', b.guests !== null ? String(b.guests) : null, b.from.guests],
			['Date', b.date ? day(b.date) : null, b.from.date],
			['Service', b.serviceStyle ? STYLE_LABEL[b.serviceStyle] : null, b.from.serviceStyle],
			...(b.courses !== null || b.serviceStyle === 'plated' || b.serviceStyle === 'family'
				? [
						['Courses', b.courses !== null ? String(b.courses) : null, b.from.courses] as [
							string,
							string | null,
							string | undefined
						]
					]
				: []),
			[
				'Dietary',
				b.dietary === null ? null : b.dietary.length ? b.dietary.join(', ') : 'none',
				b.from.dietary
			],
			[
				'Budget',
				b.budgetCents === null
					? null
					: b.budgetCents
						? money(b.budgetCents, { whole: true })
						: 'none',
				b.from.budget
			],
			...(b.notes.length
				? [['Notes', b.notes.join('; '), undefined] as [string, string, undefined]]
				: [])
		];
	}

	function startOver() {
		reset();
		answers = [];
		briefAnswers = [];
		deliverBy = null;
		text = '';
		nonce = newNonce();
	}

	/** Sandboxes only (own or shared room): a fresh run with the seed kitchens; the old run stays for audit. */
	let sandboxNote = $state<string | null>(null);
	async function resetSandbox() {
		busy = true;
		sandboxNote = null;
		try {
			const res = await fetch('/api/demo/sandbox/reset', { method: 'POST' });
			const b = await res.json().catch(() => null);
			if (res.status === 429)
				sandboxNote = `This sandbox was just reset. Try again in ${Math.ceil((b?.retryInMs ?? 0) / 1000)} s.`;
			else if (!res.ok) sandboxNote = b?.error?.message ?? `Reset failed (HTTP ${res.status}).`;
			else {
				startOver();
				sandboxNote = `Sandbox started over: fresh run ${b.runId}, no orders yet.`;
			}
		} catch (e) {
			sandboxNote = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	/** What the rounding added, in words; nothing when the line is exactly what was asked for. */
	function roundingText(l: Plan['lines'][number]): string | null {
		const need = l.needId ? plan?.needs.find((n) => n.id === l.needId) : null;
		const ph = l.view?.physical;
		if (need && ph && need.amount.unit === ph.unit)
			return ph.value > need.amount.value + 1e-9
				? `rounded up from ${num(need.amount.value, 3)} ${need.amount.unit}`
				: null;
		return l.qty.rounding ?? null;
	}

	// The shell shows where the data comes from and the sandbox (workspace, run, clock, start over).
	const shell = useShell();
	const valioSource = $derived.by(() => {
		if (!lookup?.quotedIds.length) return null;
		const at =
			lookup.items
				.flatMap((i) => i.shortlist)
				.map((c) => c.offer?.price?.provenance.at ?? c.offer?.availability.provenance.at)
				.find((x): x is string => !!x) ?? data.now;
		return { live: lookup.offerSources.includes('valio_live'), at };
	});
	$effect(() => {
		if (!shell) return;
		shell.labels = { source: valioSource, offline: false };
		shell.sandbox = {
			workspace: data.workspace.id,
			run: data.workspace.run,
			clock: storyTime(data.now),
			busy,
			onReset: resetSandbox
		};
		// The agent dock follows this request: its kitchen, and the plan it produced once there is one.
		shell.chat = {
			kitchenId: order?.plan.kitchenId ?? (kitchenId || undefined),
			planId: order?.plan.id
		};
		return () => {
			shell.labels = null;
			shell.sandbox = null;
			shell.chat = {};
		};
	});
	/** Offers are dated on the scenario clock, so a cut-off before its now has passed. */
	const cutoffText = (iso: string | null) =>
		!iso
			? ''
			: Date.parse(iso) < Date.parse(data.now)
				? ` · cut-off passed (${expires(iso)})`
				: ` · cut-off ${expires(iso)}`;
	const qtyText = (q: number | null, u: string | null) =>
		q === null ? '? ' : `${num(q, 3)} ${u ? (UNIT_WORDS[u] ?? u) : ''}`;
	const expires = (iso: string | null) =>
		iso
			? new Intl.DateTimeFormat('en-GB', {
					weekday: 'short',
					day: 'numeric',
					month: 'short',
					hour: '2-digit',
					minute: '2-digit',
					timeZone: 'Europe/Helsinki'
				}).format(new Date(iso))
			: '—';
</script>

<svelte:head><title>Purchase request · Mandate</title></svelte:head>

<main class="mx-auto max-w-[820px] px-4 pt-6 pb-24 sm:pt-10">
	<header class="mb-5 flex flex-wrap items-end justify-between gap-3">
		<div>
			<p class="text-meta font-medium tracking-[0.08em] text-ink-3 uppercase">
				Mandate · purchase request
			</p>
			<h1 class="mt-1 text-title leading-tight font-semibold tracking-[-0.01em] sm:text-display">
				What does the kitchen need?
			</h1>
		</div>
		<label class="flex items-center gap-2 text-body text-ink-2">
			<span>Kitchen</span>
			<select
				bind:value={kitchenId}
				onchange={startOver}
				class="h-9 max-w-[15rem] rounded-md border border-rule-strong bg-sheet px-2 text-body text-ink"
			>
				{#each data.kitchens as k (k.id)}<option value={k.id}>{k.name}</option>{/each}
			</select>
		</label>
	</header>
	{#if sandboxNote}
		<p class="-mt-2 mb-4 text-body text-ink-2" role="status">{sandboxNote}</p>
	{/if}

	<form
		class="rounded-xl border border-rule-strong bg-sheet p-2 shadow-[0_1px_0_oklch(0.9_0.01_85)] focus-within:border-accent/60"
		onsubmit={(e) => {
			e.preventDefault();
			submit();
		}}
	>
		<label for="req" class="sr-only">Purchase request</label>
		<textarea
			id="req"
			bind:value={text}
			rows="2"
			maxlength="500"
			placeholder={PLACEHOLDER}
			class="block w-full resize-none bg-transparent px-2.5 pt-2 text-title leading-snug text-ink placeholder:text-ink-3 focus:outline-none"
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					submit();
				}
			}}></textarea>
		<div class="flex items-center justify-between gap-2 px-1 pt-1">
			<span class="hidden px-1.5 text-meta text-ink-3 sm:inline"
				>English or Finnish. Quantity, product, day.</span
			>
			<button
				type="submit"
				disabled={busy || !ready}
				class="ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-body font-medium whitespace-nowrap text-sheet hover:bg-accent-ink disabled:opacity-50"
			>
				Find and price <ArrowRight size={16} aria-hidden="true" />
			</button>
		</div>
	</form>

	<div class="mt-3 flex flex-wrap items-center gap-2" aria-label="Examples">
		<span class="text-meta text-ink-3">Try</span>
		{#each EXAMPLES as ex (ex)}
			<button
				type="button"
				disabled={busy || !ready}
				onclick={() => submit(ex)}
				class="h-8 rounded-full border border-rule-strong bg-sheet px-3 text-body text-ink-2 hover:border-accent/50 hover:text-accent-ink disabled:opacity-50"
				>{ex}</button
			>
		{/each}
	</div>

	{#if error}
		<p
			class="mt-4 flex items-start gap-2 rounded-lg border border-out/30 bg-out-wash px-3 py-2 text-body text-out"
			role="alert"
		>
			<TriangleAlert size={16} class="mt-0.5 shrink-0" aria-hidden="true" />{error}
		</p>
	{/if}

	{#if status.request !== 'idle'}
		<ol class="mt-8" aria-label="Request, lookup, order, approval">
			<!-- 1 · Request -->
			<Step n={1} title="Request" status={status.request} ms={ms.request}>
				{#snippet sources()}
					{#if parsed}<SourceTag
							source={parsed.parser.kind === 'rules' ? 'parsed' : 'llm'}
							compact
						/>{/if}
				{/snippet}
				{#if parsed}
					<p class="text-meta text-ink-3">
						{#if parsed.parser.kind === 'rules'}Parsed by rules: deterministic, no model call.{:else}Parsed
							by {parsed.parser.model} ·
							{#if shell?.system}<span class="mono"
									>{parsed.parser.tokens?.in ?? 0} in / {parsed.parser.tokens?.out ?? 0} out · {parsed
										.parser.latencyMs} ms</span
								>;{/if} dates from the sim clock.{/if}
						{#if parsed.parser.fallback}<span class="text-signoff">
								Model path not used: {parsed.parser.fallback}.</span
							>{/if}
					</p>
					<ul class="mt-2 space-y-1.5" hidden={!!event}>
						{#each parsed.items as it (it.id)}
							<li class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-heading">
								<b class="num font-semibold">{qtyText(it.qty, it.unit)}</b>
								<span>{it.product ?? it.query}</span>
								{#each it.constraints as c (c)}<span
										class="rounded border border-accent/30 bg-accent-wash px-1.5 text-meta text-accent-ink"
										>{CONSTRAINT_WORDS[c] ?? c}</span
									>{/each}
								{#if it.variant}<span class="rounded border border-rule px-1.5 text-meta text-ink-2"
										>{it.variant.label}</span
									>{/if}
								<span class="mono text-micro text-ink-3">search “{it.search[0] ?? '—'}”</span>
							</li>
						{/each}
					</ul>
					<p class="mt-2 text-body text-ink-2" hidden={!!event}>
						Deliver by <b class="font-medium text-ink">{day(parsed.deliverBy)}</b>
						{#if parsed.deliverByText}<span class="text-ink-3">from “{parsed.deliverByText}”</span
							>{:else}<span class="text-signoff">(no day given)</span>{/if}
					</p>
					{#if parsed.answered?.length}
						<p class="mt-2 text-body text-ink-2">
							Your answers: {parsed.answered.map(answerText).join(' · ')}
							<button
								type="button"
								class="ml-1 text-accent-ink underline"
								disabled={busy}
								onclick={() => submit(text)}>clear</button
							>
						</p>
					{/if}
					<!-- An event brief has no items: item questions about it would be noise. -->
					{@const asks = event
						? []
						: [
								...parsed.ambiguities,
								...parsed.items.flatMap((i) =>
									i.ambiguities.map((a) => `${i.product ?? i.query}: ${a}`)
								)
							]}
					{@const notes = event ? [] : parsed.notes}
					{#if notes.length}
						<ul class="mt-2 space-y-0.5 text-body text-ink-2" aria-label="Notes">
							{#each notes as n (n)}<li class="flex gap-2">
									<Info size={14} class="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />{n}
								</li>{/each}
						</ul>
					{/if}
					{#if asks.length}
						<ul
							class="mt-2 space-y-1 rounded-lg border border-signoff/30 bg-signoff-wash px-3 py-2 text-body text-ink"
						>
							{#each asks as a (a)}<li class="flex gap-2">
									<TriangleAlert
										size={14}
										class="mt-0.5 shrink-0 text-signoff"
										aria-hidden="true"
									/>{a}
								</li>{/each}
						</ul>
					{/if}
					{#if event}
						<div
							class="mt-3 rounded-lg border border-accent/30 bg-accent-wash px-3 py-2.5 text-body text-ink"
							data-testid="event-brief"
						>
							<p class="font-medium">
								Event brief.
								<span class="font-normal text-ink-2"
									>This reads as an event to plan, not products to buy, so nothing was searched or
									ordered.</span
								>
							</p>
							{#if event.draft}
								{@const b = event.draft}
								<dl
									class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-body"
									aria-label="Brief so far"
								>
									{#each briefRows(b) as [k, v, f] (k)}
										<dt class="text-ink-2">{k}</dt>
										<dd class={v ? 'text-ink' : 'text-ink-3'}>
											{v ?? 'to ask'}{#if f === 'answer'}<span class="ml-1.5 text-ink-3">
													· your answer</span
												>{/if}
										</dd>
									{/each}
								</dl>
							{/if}
							{#if event.question}
								{#key event.question.id}
									<BriefAsk q={event.question} {busy} onanswer={answerBrief} />
								{/key}
							{:else if event.draft}
								<p class="mt-2 text-body font-medium text-ink">
									Brief complete.
									<span class="font-normal text-ink-2"
										>{menu ? 'Review the menu below.' : 'Proposing a menu…'}</span
									>
								</p>
								{#if proposing}
									<ol
										class="mt-2 space-y-1 text-body"
										aria-label="Proposing a menu"
										data-testid="menu-progress"
									>
										<li class="flex items-center gap-2 text-ink">
											<Check size={14} class="text-accent" aria-hidden="true" /> Brief read: {event
												.draft.guests} guests,
											{event.draft.date ? day(event.draft.date) : ''}
										</li>
										<li
											class="flex items-center gap-2 {proposing.dishes ? 'text-ink' : 'text-ink-2'}"
										>
											{#if proposing.dishes}<Check
													size={14}
													class="text-accent"
													aria-hidden="true"
												/>
												{proposing.dishes.length} dishes from {proposing.source === 'llm'
													? 'the model'
													: 'the team templates'}:
												{proposing.dishes.join(', ')}{:else}<LoaderCircle
													size={14}
													class="animate-spin text-accent"
													aria-hidden="true"
												/>
												Writing dishes and amounts per guest…{/if}
										</li>
										<li
											class="flex items-center gap-2 {proposing.total ? 'text-ink' : 'text-ink-3'}"
										>
											{#if proposing.total}<LoaderCircle
													size={14}
													class="animate-spin text-accent"
													aria-hidden="true"
												/>
												Matching ingredients to Valio products: {proposing.done} of {proposing.total}{:else}<span
													class="inline-block size-3.5"
												></span> Matching ingredients to Valio products{/if}
										</li>
									</ol>
								{/if}
							{/if}
							{#if event.seeded}
								<a
									href={resolve('/')}
									class="mt-2 inline-flex items-center gap-1 text-body font-medium text-accent-ink underline"
									>Or open the planned {event.seeded.title} in the Kitchen <ArrowRight
										size={14}
										aria-hidden="true"
									/></a
								>
							{/if}
						</div>
						{#if menu}
							<MenuReview
								view={menu}
								busy={busy || menuBusy}
								plan={menuPlan}
								onchange={editMenu}
								onaccept={acceptMenu}
								onplan={planMenu}
							/>
						{/if}
					{/if}
				{/if}
			</Step>

			<!-- 2 · Lookup -->
			<Step n={2} title="Lookup" status={status.lookup} ms={ms.lookup}>
				{#snippet sources()}
					{#if lookup}
						<SourceTag source="valio_static" compact />
						{#if lookup.quotedIds.length}<SourceTag
								source={lookup.offerSources.includes('valio_live') ? 'valio_live' : 'valio_cache'}
								compact
							/>{/if}
					{/if}
				{/snippet}
				{#if lookup}
					<p class="text-meta text-ink-3">
						{lookup.searchCalls} catalogue search{lookup.searchCalls === 1 ? '' : 'es'} (static, no Valio
						call) ·
						{#if lookup.quotedIds.length}1 quote for {lookup.quotedIds.length} shortlisted id{lookup
								.quotedIds.length === 1
								? ''
								: 's'} ({offerSourceWords(lookup.offerSources)}){:else}nothing quoted{/if}
					</p>
					{#if lookup.sanity.length}
						<div
							class="mt-3 rounded-lg border border-out/35 bg-out-wash px-3 py-2.5 text-body"
							role="alert"
						>
							<p class="font-medium text-out">
								{lookup.hardLimit ? 'Over the hard limit' : 'Unusually large order'}{needsConfirm
									? ': nothing placed yet'
									: ''}
							</p>
							<ul class="mt-1 space-y-0.5 text-ink">
								{#each lookup.sanity as w (w)}<li>· {w}.</li>{/each}
							</ul>
							{#if needsConfirm}
								<div class="mt-2 flex flex-wrap gap-2">
									<button
										type="button"
										disabled={busy}
										onclick={() => submit(text, true, true)}
										class="h-9 rounded-md border border-out/50 bg-sheet px-3 text-body font-medium text-out hover:bg-out-wash disabled:opacity-50"
										>{lookup.hardLimit
											? 'Place it anyway (it will be refused: over the hard limit)'
											: 'Place it anyway (still needs approval)'}</button
									>
									<button
										type="button"
										onclick={() => document.getElementById('req')?.focus()}
										class="h-9 rounded-md px-3 text-body text-ink-2 hover:text-ink"
										>Change the request</button
									>
								</div>
							{/if}
						</div>
					{/if}
					<div class="mt-3 space-y-4">
						{#each lookup.items as it, i (i)}
							<article class="rounded-lg border border-rule bg-sheet">
								<header class="border-b border-rule px-3 py-2 text-body text-ink-2">
									<b class="font-medium text-ink">{it.item.query}</b> · {it.searches.reduce(
										(s, x) => s + x.hits,
										0
									)} hits, {it.rejectedCount} filtered out, {it.shortlist.length} shortlisted
								</header>
								{#if it.pick && it.pick.conversion?.ok}
									{@const o = it.pick.offer}
									<div class="px-3 py-2.5">
										<p class="flex flex-wrap items-baseline gap-x-2 text-heading font-medium">
											{it.pick.name}<span class="mono text-meta font-normal text-ink-3"
												>{it.pick.productId}</span
											>
										</p>
										<dl class="mt-1.5 grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-1 text-body">
											<dt class="text-ink-3">Why this one</dt>
											<dd>{it.pick.reasons.join('; ') || 'best remaining match'}</dd>
											<dt class="text-ink-3">Quantity</dt>
											<dd class="num">
												{quantityWords(
													it.pick.conversion.salesQty,
													it.pick.salesUnit,
													it.pick.amount
												)}{#if it.pick.amount}<span class="text-ink-2"
														>{` = ${num(it.pick.amount.value, 3)} ${it.pick.amount.unit}`}</span
													>{/if}
												<span class="block text-meta text-ink-3">{it.pick.conversion.explain}</span>
											</dd>
											{#each it.pick.conversion.warnings as w (w)}<dt></dt>
												<dd class="text-signoff">{w}</dd>{/each}
											<dt class="text-ink-3">Price</dt>
											<dd class="num">
												{money(o?.price?.unitCents)} per {unitWord(it.pick.salesUnit)}
												<span class="text-ink-3">ex VAT</span>
											</dd>
											<dt class="text-ink-3">Availability</dt>
											<dd>
												{availText(o ?? undefined)}{o?.availability.logisticModel
													? ` · ${o.availability.logisticModel}`
													: ''}{cutoffText(o?.availability.closingTime ?? null)}
											</dd>
										</dl>
									</div>
								{/if}
								{#if it.question}
									<p class="flex gap-2 border-t border-rule bg-signoff-wash px-3 py-2 text-body">
										<TriangleAlert
											size={15}
											class="mt-0.5 shrink-0 text-signoff"
											aria-hidden="true"
										/>{it.question}
									</p>
									{#if it.answer}<Answer
											spec={it.answer}
											{busy}
											onanswer={answer}
											ondate={chooseDate}
										/>{/if}
								{/if}
								{#each it.valioRules as r (r.to)}
									<p
										class="border-t border-dashed border-rule px-3 py-2 text-body {r.status ===
										'skipped'
											? 'text-undeliv'
											: 'text-ink-2'}"
									>
										Valio's own substitute rule <span class="mono">{r.from} → {r.to}</span>{r.toName
											? ` (${r.toName})`
											: ''}:
										<b class="font-medium"
											>{r.status === 'skipped'
												? 'skipped'
												: r.status === 'available'
													? 'kept as fallback'
													: 'not quoted'}</b
										>, {r.reason}.
									</p>
								{/each}
								<details class="border-t border-rule px-3 py-2 text-body">
									<summary class="cursor-pointer text-ink-2">Shortlist and filtered hits</summary>
									<ol class="mt-2 space-y-1.5">
										{#each it.shortlist as c, ci (c.productId)}
											<li class="grid grid-cols-[1.25rem_1fr] gap-x-1.5">
												<span class="num text-ink-3">{ci + 1}.</span>
												<span>
													<span class={c.picked ? 'font-medium text-accent-ink' : ''}>{c.name}</span
													>
													<span class="mono text-micro text-ink-3"
														>{c.productId} · score {c.score}</span
													>
													<span class="block text-ink-2">
														{#if c.picked}Picked.{:else if c.skipped}<span class="text-undeliv"
																>Skipped: {c.skipped}.</span
															>{:else if c.offer}Not needed: an earlier match was picked.{:else}Not
															quoted.{/if}
														{#if c.offer?.price}{money(c.offer.price.unitCents)} / {c.salesUnit}.{/if}
														{#if c.conversion}{c.conversion.ok
																? c.conversion.explain
																: `Can't convert: ${c.conversion.reason}`}{/if}
													</span>
												</span>
											</li>
										{/each}
									</ol>
									{#if it.rejected.length}
										<p class="mt-2 text-ink-3">Filtered out ({it.rejectedCount}), e.g.:</p>
										<ul class="mt-1 space-y-0.5 text-ink-3">
											{#each it.rejected as r (r.productId)}<li>
													<span class="mono text-micro">{r.productId}</span>
													{r.name}: {r.reason}
												</li>{/each}
										</ul>
									{/if}
								</details>
							</article>
						{/each}
					</div>
				{/if}
			</Step>

			<!-- 3 · Order -->
			<Step n={3} title="Order" status={status.order} ms={ms.order}>
				{#snippet sources()}
					{#if order}<SourceTag source="mandate" compact />{/if}
				{/snippet}
				{#if order && plan}
					<p class="text-meta text-ink-3">
						{orderStatusWords()} · key
						<span class="mono">{order.idempotencyKey}</span>
						{#if order.replayed}· <b class="font-medium text-ink-2"
								>same words, same key: the earlier plan returned, no second order</b
							>{/if}
					</p>
					<div class="mt-2 overflow-hidden rounded-lg border border-rule bg-sheet">
						{#each plan.lines as l (l.id)}
							<div class="border-b border-rule px-3 py-2.5 last:border-b-0">
								<div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
									<div class="min-w-0">
										<p class="text-heading font-medium">
											{l.productName ?? names.get(l.productId) ?? l.productId}
										</p>
										<p class="num text-body text-ink-2">
											{quantityWords(l.qty.value, l.qty.unit, l.view?.physical)} × {money(
												l.offer?.price?.unitCents
											)}
											{#if roundingText(l)}<span class="text-ink-3">({roundingText(l)})</span>{/if}
										</p>
									</div>
									<div class="flex items-center gap-2">
										<StateChip
											state={l.state}
											tier={l.tier}
											reasons={l.reasons}
											approved={approval?.state === 'granted' && approval.lineIds.includes(l.id)}
										/>
										<span class="num text-heading font-semibold">{money(l.lineCents)}</span>
									</div>
								</div>
								{#if l.reasons.length}
									<ul class="mt-1.5 space-y-0.5 text-body text-ink-2">
										{#each l.reasons as r (r)}<li>
												· {reasonWords(r, l, plan.totalCents, caps, order.kitchen)}
											</li>{/each}
									</ul>
								{/if}
							</div>
						{/each}
						<div class="flex items-center justify-between bg-well px-3 py-2 text-body">
							<span class="text-ink-2">Total ex VAT · deliver {day(plan.deliverBy)}</span>
							<b class="num text-heading">{money(plan.totalCents)}</b>
						</div>
					</div>
					{#if order.deliveryNote}<p class="mt-2 flex gap-2 text-body text-signoff">
							<TriangleAlert
								size={14}
								class="mt-0.5 shrink-0"
								aria-hidden="true"
							/>{order.deliveryNote}
						</p>{/if}
					{#if approval}
						{@const tw = tierWords(
							approval.tier,
							plan.lines
								.filter((l) => (approval?.lineIds ?? []).includes(l.id))
								.flatMap((l) => l.reasons)
						)}
						<p class="mt-2 text-body">
							<b class="font-medium">{tw.title}.</b>
							<span class="text-ink-2">{tw.body}</span>
						</p>
					{:else if plan.lines.some((l) => l.reasons.includes('over_hard_limit'))}
						<p class="mt-2 text-body">
							<b class="font-medium text-out">Over this kitchen's hard limit.</b>
							<span class="text-ink-2"
								>Nothing here can be ordered, and no approval can change that. Raise the mandate
								first, or order less.</span
							>
						</p>
					{:else if plan.lines.every((l) => l.tier === 'act')}
						<p class="mt-2 text-body">
							<b class="font-medium">{TIER_WORDS.act.title}.</b>
							<span class="text-ink-2">{TIER_WORDS.act.body}</span>
						</p>
					{/if}
					<blockquote class="mt-2 border-l-2 border-rule-strong pl-3 text-body text-ink-3 italic">
						Your mandate: “{order.kitchen.mandateWords}”
					</blockquote>
					<!-- eslint-disable svelte/no-navigation-without-resolve -- kitchen deep link with query, built from resolve('/') -->
					<p class="mt-2 text-body text-ink" data-testid="order-in-kitchen">
						This order is now in your Kitchen plan.
						<a
							href={resolve('/') + order.task.kitchenUrl.slice(1)}
							class="inline-flex items-center gap-1 font-medium text-accent-ink underline"
							>Open it in the Kitchen <ArrowRight size={14} aria-hidden="true" /></a
						>
					</p>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
			</Step>

			<!-- 4 · Approval -->
			<Step n={4} title="Approval" status={status.approval} last>
				{#snippet sources()}
					{#if committed}<SourceTag source="simulator" compact />{/if}
				{/snippet}
				{#if plan}
					{#if approval}
						<div class="rounded-lg border border-rule bg-sheet px-3 py-2.5" id="approval">
							<p class="text-body text-ink-2">
								This approval is bound to exactly these terms. Any change to price, quantity, date
								or mandate voids it.
							</p>
							<dl class="mt-2 grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1 text-body">
								<dt class="text-ink-3">Total</dt>
								<dd class="num font-semibold">{money(approval.totalCents)}</dd>
								<dt class="text-ink-3">Plan version</dt>
								<dd class="mono">v{approval.planVersion}</dd>
								{#if shell?.system}
									<dt class="text-ink-3">Terms hash</dt>
									<dd class="mono" title={approval.termsHash}>{shortHash(approval.termsHash)}…</dd>
								{/if}
								<dt class="text-ink-3">Mandate</dt>
								<dd class="mono">
									{approval.mandateVersion === null ? '—' : `v${approval.mandateVersion}`}
								</dd>
								<dt class="text-ink-3">Expires</dt>
								<dd>{expires(approval.expiresAt)} <span class="text-ink-3">(sim clock)</span></dd>
								<dt class="text-ink-3">State</dt>
								<dd>
									<b class="font-medium">{APPROVAL_STATE_WORDS[approval.state] ?? approval.state}</b
									>{approval.decidedBy ? ` by ${approval.decidedBy}` : ''}
								</dd>
							</dl>
						</div>
						{#if approval.state === 'pending'}
							<div class="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
								<button
									type="button"
									disabled={busy}
									onclick={() => decide('grant')}
									class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 text-body font-medium text-sheet hover:bg-accent-ink disabled:opacity-50"
									><Check size={16} aria-hidden="true" /> Approve {money(approval.totalCents)} as head
									chef</button
								>
								<button
									type="button"
									disabled={busy}
									onclick={() => decide('deny')}
									class="h-11 rounded-md border border-rule-strong px-4 text-body text-ink-2 hover:text-out disabled:opacity-40"
									>Deny</button
								>
							</div>
						{:else if approval.state === 'denied'}
							<p class="mt-2 text-body text-ink-2">Denied. Nothing was ordered.</p>
						{/if}
					{:else if !committed}
						<p class="text-body text-ink-2">
							{#if plan.lines.every((l) => l.state === 'eligible' && l.tier === 'act')}
								No approval needed: every line is within your mandate.
							{:else if plan.lines.some((l) => l.reasons.includes('over_hard_limit'))}
								Nothing to approve: the order is over this kitchen's hard limit. Raise the mandate
								first.
							{:else}
								Nothing to approve: no line can be ordered as it stands.
							{/if}
						</p>
					{/if}

					{#if canCommit}
						<button
							type="button"
							disabled={busy}
							onclick={commit}
							class="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-accent px-4 text-body font-medium text-sheet hover:bg-accent-ink disabled:opacity-50"
						>
							<Check size={16} aria-hidden="true" /> Commit order as chef
						</button>
					{/if}

					{#if committed}
						<div class="mt-3 rounded-lg border border-accent/35 bg-accent-wash px-3 py-2.5">
							<p class="text-body font-medium text-accent-ink">
								Committed · local simulated commitment
							</p>
							<dl class="mt-1.5 grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1 text-body">
								<dt class="text-ink-3">Order</dt>
								<dd class="mono">{committed.orderId}</dd>
								<dt class="text-ink-3">Receipt</dt>
								<dd class="mono">{committed.receiptId}</dd>
								<dt class="text-ink-3">Total</dt>
								<dd class="num font-semibold">{money(committed.totalCents)}</dd>
								<dt class="text-ink-3">Commit key</dt>
								<dd class="mono break-all">{committed.idempotencyKey}</dd>
								{#if committed.awaitingSupplier.length}<dt class="text-ink-3">Awaiting</dt>
									<dd>
										{committed.awaitingSupplier.length} line(s) ordered, not confirmed (Terminal)
									</dd>{/if}
							</dl>
						</div>
						{#if commits.length > 1}
							<ul class="mt-2 space-y-1 text-body" aria-live="polite">
								{#each commits.slice(1) as c (c.attempt)}
									<li class="flex items-start gap-2">
										<Repeat size={14} class="mt-1 shrink-0 text-accent" aria-hidden="true" />
										<span
											>Attempt {c.attempt}: {c.receiptId === committed.receiptId
												? 'same receipt'
												: 'DIFFERENT receipt'} <span class="mono">{c.receiptId}</span>, {c.receiptId ===
											committed.receiptId
												? 'no second order.'
												: 'check the op log.'}</span
										>
									</li>
								{/each}
							</ul>
						{/if}
						<div class="mt-3 flex flex-wrap gap-2">
							<button
								type="button"
								disabled={busy}
								onclick={commit}
								class="inline-flex h-10 items-center gap-1.5 rounded-md border border-rule-strong bg-sheet px-3 text-body text-ink hover:border-accent/50"
							>
								<Repeat size={15} aria-hidden="true" /> Send the same commit again
							</button>
							<button
								type="button"
								onclick={startOver}
								class="inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-body text-ink-2 hover:text-ink"
							>
								<RotateCcw size={15} aria-hidden="true" /> New request
							</button>
						</div>
					{/if}
				{/if}
			</Step>
		</ol>
		{#if resultMessage && !plan && !needsConfirm && !event}
			<p class="-mt-2 ml-11 text-body text-ink-2">{resultMessage}</p>
		{/if}
	{/if}
</main>
