<script lang="ts">
	import {
		ArrowUpRight,
		Bot,
		ChevronDown,
		CircleCheck,
		CircleX,
		MessageSquare,
		Plus,
		Send
	} from '@lucide/svelte';
	import DecisionCard from '$lib/ui/DecisionCard.svelte';
	import Receipt from '$lib/ui/Receipt.svelte';
	import type { ChatEvent, ChatTurnInput } from './types';

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
	}
	let { kitchenId = 'k-hotel', open = $bindable(false), pinned = true }: Props = $props();

	type Entry = { kind: 'chef'; text: string } | { kind: 'event'; e: ChatEvent };
	const KEY = 'mandate.chat.task';
	let taskId = $state<string | null>(read());
	let entries = $state.raw<Entry[]>([]);
	let text = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	function read(): string | null {
		try {
			return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(KEY);
		} catch {
			return null;
		}
	}
	function remember(id: string | null) {
		try {
			if (id) sessionStorage.setItem(KEY, id);
			else sessionStorage.removeItem(KEY);
		} catch {
			/* storage blocked: the task lives for this page only */
		}
	}

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
	const doneLine = $derived(last?.kind === 'event' && last.e.type === 'done' ? last.e : undefined);

	async function turn(body: ChatTurnInput, said?: string) {
		if (busy) return;
		busy = true;
		error = null;
		if (said) entries = [...entries, { kind: 'chef', text: said }];
		try {
			const res = await fetch('/api/chat/turn', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ...body, ...(taskId ? { taskId } : {}), kitchenId })
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
						taskId = e.taskId;
						remember(taskId);
					}
					entries = [...entries, { kind: 'event', e }];
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
		remember(null);
		entries = [];
		error = null;
	}

	const TOOL: Record<string, string> = {
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
		open && 'hidden'
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
				{taskId ? `Task ${taskId}` : 'Plans and orders within your mandate. Never approves.'}
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

	<ol class="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-body" aria-live="polite">
		{#if !entries.length}
			<li class="text-ink-3">
				Try “4 kg lactose-free butter for Wednesday” or “what needs my approval?”. Answers to the
				agent’s questions come as buttons.
			</li>
		{/if}
		{#each entries as x, i (i)}
			{#if x.kind === 'chef'}
				<li class="ml-8 rounded-lg bg-well px-3 py-2 text-ink">{x.text}</li>
			{:else if x.e.type === 'step'}
				<li class="flex gap-2 text-ink-2">
					{#if x.e.ok}
						<CircleCheck size={15} class="mt-0.5 shrink-0 text-ok" />
					{:else}
						<CircleX size={15} class="mt-0.5 shrink-0 text-out" />
					{/if}
					<div class="min-w-0">
						<span class="font-medium text-ink">{TOOL[x.e.tool] ?? x.e.tool}.</span>
						{x.e.summary}
						{#if x.e.receipt}
							<div class="mt-1"><Receipt receipt={x.e.receipt} orders={latestReceipts || 1} /></div>
						{/if}
						{#if x.e.href}
							<a class="ml-1 inline-flex items-center text-accent-ink underline" href={x.e.href}
								>plan<ArrowUpRight size={12} /></a
							>
						{/if}
					</div>
				</li>
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
			{:else if x.e.type === 'decision'}
				{@const names = new Map(Object.entries(x.e.names))}
				<li class="space-y-2">
					{#each x.e.decisions as d (d.key)}
						<DecisionCard decision={d} {names} due={x.e.due} readonly />
					{/each}
					<a
						class="inline-flex items-center gap-1 font-medium text-propose underline"
						href={x.e.approvalUrl}>Open the approval in Kitchen <ArrowUpRight size={13} /></a
					>
					<p class="text-meta text-ink-3">
						Only a chef approves, in the Kitchen screen. Then continue here.
					</p>
				</li>
			{:else if x.e.type === 'ledger'}
				<li class="border-l-2 border-accent pl-3 text-ink">
					<span class="num">{x.e.summary}</span>
				</li>
			{:else if x.e.type === 'done' && x === last && x.e.state !== 'awaiting_clarification'}
				<li class="flex flex-wrap gap-2">
					{#if x.e.canContinue || x.e.state === 'awaiting_chef'}
						<button
							type="button"
							class="rounded-md bg-accent px-3 py-1.5 text-meta font-semibold text-sheet disabled:opacity-50"
							disabled={busy}
							onclick={() => turn({ continue: true }, 'Continue')}
						>
							{x.e.canContinue ? 'Continue: submit what may be ordered' : 'I’ve decided: continue'}
						</button>
					{/if}
				</li>
			{/if}
		{/each}
		{#if busy}<li class="text-ink-3">Working…</li>{/if}
		{#if error}<li class="text-out">{error}</li>{/if}
	</ol>

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
