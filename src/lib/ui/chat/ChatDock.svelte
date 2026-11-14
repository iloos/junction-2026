<script lang="ts">
	import {
		ArrowUpRight,
		Bot,
		ChevronDown,
		CircleCheck,
		CircleX,
		MessageSquare,
		Plus,
		Send,
		UtensilsCrossed
	} from '@lucide/svelte';
	import { untrack } from 'svelte';
	import DecisionCard from '$lib/ui/DecisionCard.svelte';
	import { decisionsOf } from '$lib/ui/decisions';
	import { day, money } from '$lib/ui/format';
	import { KitchenStore } from '$lib/kitchen/kitchen.svelte';
	import Receipt from '$lib/ui/Receipt.svelte';
	import type { ChatEvent, ChatTurnInput } from './types';
	import { foldRows, outcomeLine, stepsSinceChef, workedLine, type Entry } from './turn-view';
	import { useShell } from '$lib/ui/shell/shell.svelte';

	/**
	 * The chat dock: a right-hand column on desktop, a bottom sheet on a phone, scoped to one procurement task. It
	 * sends turns to POST /api/chat/turn and renders the NDJSON lines as they come: steps with our own summaries
	 * linking to the plan, a question with chip answers, a decision card that links to the Kitchen approval panel
	 * (there is no approve button here, by design) and the outcome line from the task ledger.
	 */
	interface Props {
		kitchenId?: string;
		/** Start collapsed on a phone; the desktop column is always open when pinned. */
		open?: boolean;
		/** Desktop: always-open column (agent page). Unpinned, it opens and closes like the phone sheet (Kitchen). */
		pinned?: boolean;
		/** The plan the screen has open: a turn without a task joins the task that holds it. */
		planId?: string;
		/** Open this task (a link to it); otherwise the task remembered for this kitchen. */
		taskId?: string;
		/** Its own floating "Ask the agent" button; off when the app shell opens the dock. */
		launcher?: boolean;
		/** Said next to the composer, e.g. a shared demo room where others can see what you type. */
		notice?: string | null;
	}
	let {
		kitchenId = 'k-hotel',
		open = $bindable(false),
		pinned = true,
		planId,
		taskId: openTask,
		launcher = true,
		notice = null
	}: Props = $props();

	/**
	 * The decision's plan is the one on screen: show its decisions in place (the page scrolls to them) instead of
	 * navigating, which would reload the screen.
	 */
	const shell = useShell();
	function locate(
		ev: MouseEvent,
		plan: string,
		at: { decision?: string; zone?: 'decide' | 'order' } = {}
	) {
		if (!shell || plan !== planId) return;
		ev.preventDefault();
		shell.locate = { planId: plan, at: Date.now(), ...at };
		// The dock overlays the approval panel on desktop and the page on a phone: close it so the card shows.
		if (!pinned) open = false;
	}

	/** The dock's task is remembered per kitchen for this browser tab. */
	const key = () => `mandate.chat.task.${kitchenId}`;
	let taskId = $state<string | null>(null);
	let entries = $state.raw<Entry[]>([]);
	/** After "New task": the next turn starts its own task instead of joining the plan on screen. */
	let fresh = $state(false);
	let text = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	function read(): string | null {
		try {
			return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key());
		} catch {
			return null;
		}
	}
	function remember(id: string | null) {
		try {
			if (id) sessionStorage.setItem(key(), id);
			else sessionStorage.removeItem(key());
		} catch {
			/* storage blocked: the task lives for this page only */
		}
	}

	/**
	 * On opening (and on a kitchen switch): the remembered task's cards as they are now, read from its plans, so an
	 * approval made on the Kitchen screen meanwhile shows up and an old card never lingers.
	 */
	let loadedFor: string | null = null;
	$effect(() => {
		const k = `${kitchenId}:${openTask ?? ''}`;
		if (!open && !pinned) return;
		if (loadedFor === k) return;
		loadedFor = k;
		taskId = openTask ?? read();
		if (openTask) remember(openTask);
		entries = [];
		if (taskId) void restore(taskId);
	});

	async function restore(id: string) {
		try {
			const res = await fetch(`/api/chat/task?id=${encodeURIComponent(id)}`);
			if (!res.ok) return;
			const { events } = (await res.json()) as { events: ChatEvent[] };
			const done = events.at(-1);
			if (done?.type === 'done' && done.state === 'failed') {
				newTask();
				return;
			}
			if (taskId === id) entries = events.map((e) => ({ kind: 'event', e }));
		} catch {
			/* offline: the next turn reads the task */
		}
	}

	/** The newest line stays in view as a turn streams in. */
	let list = $state<HTMLOListElement | null>(null);
	$effect(() => {
		void entries.length;
		void busy;
		list?.scrollTo({ top: list.scrollHeight });
	});

	const last = $derived(entries.findLast((x) => x.kind === 'event'));
	const pendingClarify = $derived(
		last?.kind === 'event' && last.e.type === 'done' && last.e.state === 'awaiting_clarification'
			? entries.findLast((x) => x.kind === 'event' && x.e.type === 'clarify')
			: undefined
	);
	/** Orders on the task's plans, from the newest ledger (a repeated key stays one order). */
	const latestReceipts = $derived.by(() => {
		const l = entries.findLast((x) => x.kind === 'event' && x.e.type === 'ledger');
		return l?.kind === 'event' && l.e.type === 'ledger' ? l.e.ledger.receiptIds.length : 0;
	});
	const rows = $derived(foldRows(entries));
	/** Steps so far in the turn that is running, for the indicator ("step 3"). */
	const stepsThisTurn = $derived(stepsSinceChef(entries));
	/**
	 * Approving from the dock (D13): the newest decision's plan, when it is not the plan on the page, gets its own
	 * Kitchen state here. The chef approves with the same exact terms, the same hold-to-confirm and the same Kitchen
	 * command as the page, as the signed-in chef; never through the model or a chat turn. On the plan the page
	 * shows, the page's card is the one control and the dock links to it.
	 */
	const lastDecision = $derived(
		entries.findLast((x) => x.kind === 'event' && x.e.type === 'decision')
	);
	const actPlan = $derived(
		lastDecision?.kind === 'event' && lastDecision.e.type === 'decision'
			? lastDecision.e.planId
			: null
	);
	let own = $state.raw<KitchenStore | null>(null);
	let ownFor: string | null = null;
	$effect(() => {
		const id = actPlan;
		if (!id || id === planId || !(open || pinned) || id === ownFor) return;
		ownFor = id;
		untrack(() => {
			const st = new KitchenStore('live', false);
			own = st;
			void st.load(id);
		});
	});
	/** The chef decided or ordered here: the turn's own outcome line predates it, so it gives way. */
	const actedHere = $derived(!!own?.lastCommit);
	const lastDecisionAt = $derived(lastDecision ? entries.indexOf(lastDecision) : -1);
	const ownSnap = $derived(own?.snap && own.snap.plan.id === actPlan ? own.snap : null);
	const liveDecisions = $derived(ownSnap ? decisionsOf(ownSnap.plan, ownSnap.approval) : []);
	const ownNames = $derived(
		new Map((ownSnap?.plan.lines ?? []).map((l) => [l.productId, l.productName ?? l.productId]))
	);
	const approvedOpen = $derived(
		(ownSnap?.plan.lines ?? []).filter(
			(l) => l.state !== 'committed' && l.view?.committable === true
		)
	);

	/** The plan the task works on, from its newest ledger or decision. */
	const taskPlan = $derived.by(() => {
		for (let j = entries.length - 1; j >= 0; j--) {
			const x = entries[j];
			if (x.kind !== 'event') continue;
			if (x.e.type === 'decision') return x.e.planId;
			if (x.e.type === 'ledger' && x.e.ledger.needs[0]) return x.e.ledger.needs[0].planId;
		}
		return null;
	});
	/**
	 * The task named by what it is about: its own title when the server sends one, else the chef's first words, else
	 * the needs it holds. The task id is for the System layer.
	 */
	const taskTitle = $derived.by(() => {
		for (const x of entries)
			if (x.kind === 'event' && 'title' in x.e && typeof x.e.title === 'string' && x.e.title)
				return x.e.title;
		const said = entries.find((x) => x.kind === 'chef');
		if (said?.kind === 'chef') return said.text;
		const l = entries.findLast((x) => x.kind === 'event' && x.e.type === 'ledger');
		const labels =
			l?.kind === 'event' && l.e.type === 'ledger' ? l.e.ledger.needs.map((n) => n.label) : [];
		return labels.length ? labels.slice(0, 3).join(', ') : 'Your task';
	});
	const doneLine = $derived(last?.kind === 'event' && last.e.type === 'done' ? last.e : undefined);

	async function turn(body: ChatTurnInput, said?: string) {
		if (busy) return;
		busy = true;
		error = null;
		if (said) entries = [...entries, { kind: 'chef', text: said, at: Date.now() }];
		try {
			const res = await fetch('/api/chat/turn', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					...body,
					...(taskId ? { taskId } : planId && !fresh ? { planId } : {}),
					kitchenId
				})
			});
			if (!res.ok || !res.body) {
				const j = await res.json().catch(() => null);
				error = j?.error?.message ?? `The chat answered ${res.status}.`;
				return;
			}
			const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
			let buf = '';
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buf += value;
				let nl: number;
				while ((nl = buf.indexOf('\n')) >= 0) {
					const line = buf.slice(0, nl).trim();
					buf = buf.slice(nl + 1);
					if (!line) continue;
					const e = JSON.parse(line) as ChatEvent | { type: 'error'; error: { message: string } };
					if (e.type === 'error') {
						error = e.error.message;
						continue;
					}
					if (e.taskId && e.taskId !== taskId) {
						// The words started another task: the old task's cards leave with it.
						if (taskId) entries = entries.filter((x) => x.kind === 'chef').slice(-1);
						taskId = e.taskId;
						remember(taskId);
					}
					entries = [...entries, { kind: 'event', e, at: Date.now() }];
					fresh = false;
				}
			}
		} catch (e) {
			error = `Lost the connection: ${(e as Error).message}. The task is saved; send again to continue.`;
		} finally {
			busy = false;
		}
	}

	function submit(ev: SubmitEvent) {
		ev.preventDefault();
		const t = text.trim();
		if (!t) return;
		text = '';
		void turn({ text: t }, t);
	}

	function newTask() {
		taskId = null;
		fresh = true;
		remember(null);
		entries = [];
		error = null;
	}

	const TOOL: Record<string, string> = {
		understand: 'Understood',
		explain: 'Answered',
		search_products: 'Searched the catalogue',
		quote: 'Checked price and delivery',
		place_order: 'Drafted the order',
		commit_order: 'Submitted the order',
		get_plan: 'Read the plan',
		plan_event: 'Planned the event',
		find_substitutes: 'Looked for substitutes',
		edit_line: 'Changed a line',
		explain_line: 'Explained a line'
	};
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- the server builds the Kitchen deep links (plan and approval, query only) -->

<button
	type="button"
	class={[
		'fixed right-4 bottom-4 z-30 flex items-center gap-2 rounded-full border border-rule-strong bg-sheet px-4 py-2 text-body font-medium shadow-md',
		pinned && 'lg:hidden',
		(open || !launcher) && 'hidden'
	]}
	onclick={() => (open = true)}
>
	<MessageSquare size={16} /> Ask the agent
</button>

<aside
	class={[
		'fixed inset-x-0 bottom-0 z-40 flex max-h-[75dvh] flex-col rounded-t-xl border-t border-rule-strong bg-sheet shadow-lg lg:inset-x-auto lg:top-11 lg:right-0 lg:bottom-0 lg:max-h-none lg:w-96 lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-none',
		!open && (pinned ? 'max-lg:hidden' : 'hidden'),
		!pinned && 'lg:shadow-[-12px_0_32px_-16px_oklch(0.2_0.02_255/0.35)]'
	]}
	aria-label="Agent chat"
>
	<header class="flex items-center gap-2 border-b border-rule px-4 py-3">
		<Bot size={18} class="text-accent" />
		<div class="min-w-0 flex-1">
			<p class="text-body font-semibold">Purchasing agent</p>
			<p class="truncate text-meta text-ink-3">
				{#if taskId}{taskTitle}<span class="sys-only mono"> · {taskId}</span>{:else}Plans and orders
					within your mandate. Never approves.{/if}
			</p>
		</div>
		<button
			type="button"
			class="rounded p-1 text-ink-3 hover:bg-well"
			title="New task"
			aria-label="New task"
			onclick={newTask}><Plus size={16} /></button
		>
		<button
			type="button"
			class={['rounded p-1 text-ink-3 hover:bg-well', pinned && 'lg:hidden']}
			aria-label="Close chat"
			onclick={() => (open = false)}><ChevronDown size={16} /></button
		>
	</header>

	<ol
		bind:this={list}
		class="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-body"
		aria-live="polite"
	>
		{#if !entries.length}
			<li class="text-ink-3">
				Try “4 kg lactose-free butter for Wednesday” or “what needs my approval?”. Answers to the
				agent’s questions come as buttons.
			</li>
		{/if}
		{#each rows as r (r.i)}
			{#if r.kind === 'steps'}
				{@const bad = r.steps.filter((x) => !x.ok).length}
				<li>
					<details class="group">
						<summary
							class="flex cursor-pointer list-none items-center gap-1.5 text-meta text-ink-2 hover:text-ink"
						>
							<ChevronDown
								size={13}
								class="-rotate-90 transition-transform group-open:rotate-0"
								aria-hidden="true"
							/>
							{workedLine(r)}
							{#if bad}<span class="text-out">· {bad} refused</span>{/if}
						</summary>
						<ol class="mt-1.5 space-y-1 border-l border-rule pl-3">
							{#each r.steps as st (st.n)}
								<li class="flex gap-1.5 text-meta text-ink-2">
									{#if st.ok}
										<CircleCheck size={13} class="mt-0.5 shrink-0 text-ok" aria-hidden="true" />
									{:else}
										<CircleX size={13} class="mt-0.5 shrink-0 text-out" aria-hidden="true" />
									{/if}
									<span class="min-w-0">
										<span class="font-medium text-ink">{TOOL[st.tool] ?? st.tool}.</span>
										{st.summary}
										<span class="mono sys-only text-micro text-ink-3">{st.tool}</span>
										{#if st.href}
											<a class="inline-flex items-center text-accent-ink underline" href={st.href}
												>plan<ArrowUpRight size={11} /></a
											>
										{/if}
									</span>
								</li>
							{/each}
						</ol>
					</details>
					{#each r.steps.filter((x) => x.receipt) as st (st.n)}
						<div class="mt-2"><Receipt receipt={st.receipt!} orders={latestReceipts || 1} /></div>
					{/each}
				</li>
			{:else}
				{@const x = r.x}
				{@const i = r.i}
				{#if x.kind === 'chef'}
					<li class="ml-8 rounded-lg bg-well px-3 py-2 text-ink">{x.text}</li>
				{:else if x.e.type === 'clarify'}
					{@const active = pendingClarify === x}
					<li class="rounded-lg border border-rule bg-paper px-3 py-2">
						<p class="text-ink">{x.e.question}</p>
						{#if x.e.options.length}
							<div class="mt-2 flex flex-wrap gap-1.5">
								{#each x.e.options as o (o.value)}
									<button
										type="button"
										class="rounded-full border border-accent px-3 py-1 text-meta font-medium text-accent-ink hover:bg-accent-wash disabled:opacity-50"
										disabled={!active || busy}
										onclick={() =>
											x.e.type === 'clarify' &&
											turn({ answer: { field: x.e.field, value: o.value } }, o.label)}
										>{o.label}</button
									>
								{/each}
							</div>
						{:else if active}
							<p class="mt-1 text-meta text-ink-3">Type the answer below.</p>
						{/if}
					</li>
				{:else if x.e.type === 'menu'}
					<!-- A proposed menu: what it is, and the one way on (review it); nothing here approves or orders. -->
					<li class="rounded-lg border border-rule bg-sheet px-3 py-2.5" aria-label="Menu proposal">
						<p class="flex items-start gap-1.5 font-medium text-ink">
							<UtensilsCrossed size={15} class="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
							{x.e.title}
						</p>
						<p class="mt-0.5 text-meta text-ink-2">
							{x.e.guests} guests · {day(x.e.date)}{x.e.budgetCents
								? ` · aims at ${money(x.e.budgetCents, { whole: true })}`
								: ''}
						</p>
						<ul class="mt-1.5 space-y-0.5 text-meta text-ink">
							{#each x.e.dishes.slice(0, 4) as dish, j (j)}
								<li class="truncate">{dish.name}</li>
							{/each}
							{#if x.e.dishes.length > 4}
								<li class="text-ink-3">and {x.e.dishes.length - 4} more</li>
							{/if}
						</ul>
						{#if x.e.unresolved > 0}
							<p class="mt-1 text-meta text-signoff">
								{x.e.unresolved}
								{x.e.unresolved === 1 ? 'ingredient has' : 'ingredients have'} no product yet
							</p>
						{/if}
						{#if x.e.reviewed}
							<p class="mt-2 inline-flex items-center gap-1 text-meta font-medium text-ok">
								<CircleCheck size={13} aria-hidden="true" /> Reviewed
							</p>
						{:else}
							<a
								class="mt-2 inline-flex items-center gap-1 rounded-md border border-accent px-3 py-1.5 text-meta font-semibold text-accent-ink hover:bg-accent-wash"
								href={x.e.reviewUrl}
								>Review the menu <ArrowUpRight size={13} aria-hidden="true" /></a
							>
						{/if}
					</li>
				{:else if x.e.type === 'decision'}
					{@const names = new Map(Object.entries(x.e.names))}
					{@const here = x.e.planId === planId}
					{#if x === lastDecision && !here && ownSnap}
						<!-- D13: the chef decides here, with the page's own card and command. -->
						<li class="space-y-2" aria-label="Decide here">
							{#each liveDecisions as d (d.key)}
								<DecisionCard
									decision={d}
									names={ownNames}
									busy={own?.busy}
									onapprove={(ids) => own!.approve('grant', ids)}
									onkeep={(ids) => void own!.approve('deny', ids)}
								/>
							{/each}
							{#if !liveDecisions.length && approvedOpen.length && !own?.lastCommit}
								<button
									type="button"
									class="w-full rounded-md bg-accent px-3 py-2 text-body font-semibold text-sheet hover:bg-accent-ink disabled:opacity-50"
									disabled={own?.busy}
									onclick={() => own!.commit()}
									>Order the approved lines · {approvedOpen.length} ·
									{money(approvedOpen.reduce((t, l) => t + (l.lineCents ?? 0), 0))}</button
								>
							{/if}
							{#if own?.lastCommit}
								<p class="text-body text-ink">
									<b class="font-medium">Ordered</b> · {own.lastCommit.lines}
									{own.lastCommit.lines === 1 ? 'line' : 'lines'},
									<span class="mono">{money(own.lastCommit.totalCents)}</span>. Supplier
									confirmation is on receipt
									<span class="mono">{own.lastCommit.receiptId}</span>.
								</p>
							{/if}
							{#if own?.error}<p class="text-meta text-out">{own.error.message}</p>{/if}
							<a class="text-meta text-ink-2 underline" href={x.e.approvalUrl}
								>Open this plan in the Kitchen</a
							>
						</li>
					{:else}
						<li class="space-y-2">
							<!-- Each card opens its own decision on the page: the same card, where a chef approves it. -->
							{#each x.e.decisions as d (d.key)}
								<a
									class="group block rounded-lg focus-visible:outline-2 focus-visible:outline-propose"
									href={x.e.approvalUrl}
									onclick={(ev) =>
										x.e.type === 'decision' && locate(ev, x.e.planId, { decision: d.key })}
									aria-label="{here
										? 'Show'
										: 'Open'} this decision on the Kitchen page: {d.title ?? d.reason}"
								>
									<DecisionCard decision={d} {names} due={x.e.due} readonly compact />
									<span
										class="mt-1 inline-flex items-center gap-1 text-meta font-medium text-propose group-hover:underline"
										>{here ? 'Show on the page' : 'Open in the Kitchen'}
										<ArrowUpRight size={13} aria-hidden="true" /></span
									>
								</a>
							{/each}
							<p class="text-meta text-ink-3">
								Only a chef approves, on the page. Then continue here.
							</p>
						</li>
					{/if}
				{:else if x.e.type === 'ledger' && !(actedHere && i > lastDecisionAt)}
					<li class="border-l-2 border-accent pl-3 text-ink" title={x.e.summary}>
						{outcomeLine(x.e.ledger)}
					</li>
				{:else if x.e.type === 'done' && x.e.state !== 'awaiting_clarification'}
					{@const ledgerLine = entries[i - 1]}
					{#if !(ledgerLine?.kind === 'event' && ledgerLine.e.type === 'ledger' && ledgerLine.e.summary === x.e.text)}
						<!-- The agent's answer, worded from the ledger (the line above carries the numbers). -->
						<li class="whitespace-pre-line text-ink">{x.e.text}</li>
					{/if}
					{#if x.e.sources?.length}
						<!-- Where a sourced answer came from (a recall notice, a web fact), the site named. -->
						<li class="text-meta text-ink-3" data-testid="chat-sources">
							Sources: {#each x.e.sources as s, k (k)}{k ? ' · ' : ''}<a
									class="underline"
									href={s.url}
									target="_blank"
									rel="noopener noreferrer"
									title={s.title}>{s.host ?? s.title ?? 'link'}</a
								>{/each}
						</li>
					{/if}
					{#if x === last && x.e.canContinue && taskPlan && taskPlan === planId}
						<!-- The plan is on the page: its own Order button is the one primary action; the dock points to it. -->
						<li>
							<a
								class="inline-flex items-center gap-1 text-meta font-medium text-accent-ink underline"
								href="#order"
								onclick={(ev) => locate(ev, taskPlan!, { zone: 'order' })}
								>Order it on the page <ArrowUpRight size={13} aria-hidden="true" /></a
							>
						</li>
					{:else if x === last && !actedHere && x.e.canContinue}
						<li class="flex flex-wrap gap-2">
							<button
								type="button"
								class="rounded-md border border-accent px-3 py-1.5 text-meta font-semibold text-accent-ink hover:bg-accent-wash disabled:opacity-50"
								disabled={busy}
								onclick={() => turn({ continue: true }, 'Continue')}
							>
								{x.e.state === 'awaiting_chef'
									? 'I’ve decided: continue'
									: 'Continue: submit what may be ordered'}
							</button>
						</li>
					{/if}
				{/if}
			{/if}
		{/each}
		{#if busy}<li class="text-meta text-ink-3" role="status">
				Working · step {stepsThisTurn + 1}…
			</li>{/if}
		{#if error}<li class="text-out">{error}</li>{/if}
	</ol>

	{#if notice}
		<p
			class="border-t border-signoff/40 bg-signoff-wash px-3 py-1.5 text-meta text-ink"
			role="note"
		>
			{notice}
		</p>
	{/if}
	<form class="flex items-end gap-2 border-t border-rule p-3" onsubmit={submit}>
		<label class="sr-only" for="chat-text">Message the agent</label>
		<textarea
			id="chat-text"
			class="min-h-10 flex-1 resize-none rounded-md border border-rule-strong bg-paper px-3 py-2 text-body"
			rows="1"
			maxlength="500"
			placeholder={doneLine?.state === 'awaiting_clarification'
				? 'Answer the question…'
				: 'What do you need?'}
			bind:value={text}
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					(e.currentTarget.form as HTMLFormElement).requestSubmit();
				}
			}}></textarea>
		<button
			type="submit"
			class="rounded-md bg-ink p-2 text-sheet disabled:opacity-40"
			disabled={busy || !text.trim()}
			aria-label="Send"><Send size={16} /></button
		>
	</form>
</aside>
