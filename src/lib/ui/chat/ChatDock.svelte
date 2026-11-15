<script lang="ts">
	import {
		ArrowUpRight,
		Bot,
		ChevronDown,
		CircleCheck,
		CircleX,
		MessageSquare,
		Plus,
		RefreshCw,
		Send,
		UtensilsCrossed
	} from '@lucide/svelte';
	import { tick, untrack } from 'svelte';
	import DecisionCard from '$lib/ui/DecisionCard.svelte';
	import LineRow from '$lib/ui/LineRow.svelte';
	import { acceptAll, lineDecisions } from '$lib/kitchen/line-decisions';
	import { day, money, readableName } from '$lib/ui/format';
	import { KitchenStore } from '$lib/kitchen/kitchen.svelte';
	import Receipt from '$lib/ui/Receipt.svelte';
	import type { ChatEvent, ChatTurnInput } from './types';
	import {
		describeOps,
		foldRows,
		fromChat,
		outcomeLine,
		stepsSinceChef,
		workedLine,
		type Entry
	} from './turn-view';
	import { planOf } from '$lib/ui/shell/plan-events.svelte';
	import type { OpEnvelope } from '$lib/core/contracts';
	import { RAIL, useShell } from '$lib/ui/shell/shell.svelte';

	/**
	 * The chat dock: a right-hand column on desktop, a bottom sheet on a phone, scoped to one procurement task. It
	 * sends turns to POST /api/chat/turn and renders the NDJSON lines as they come: steps folded into one line,
	 * questions with chip answers, a menu card, decision cards and the outcome line from the task ledger. The agent
	 * never approves: on the plan the page shows, a decision card links to the page's own card; on another plan the
	 * chef approves here with the page's card and Kitchen command, as the chef, never through a chat turn (D13).
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
		kitchenId,
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
	/** The conversation is the page (/request): in the page's flow, full width, always open (D23). */
	const full = $derived(!!shell?.chatFull);
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
	// On a page with a plan the dock remembers the task for that plan only; the kitchen's newest task is the
	// "earlier conversation".
	const kitchenKey = () => `mandate.chat.task.${kitchenId ?? 'this-kitchen'}`;
	const key = () => (planId ? `${kitchenKey()}.${planId}` : kitchenKey());
	let taskId = $state<string | null>(null);
	let entries = $state.raw<Entry[]>([]);
	/** After "New task": the next turn starts its own task instead of joining the plan on screen. */
	let fresh = $state(false);
	let text = $state('');
	// A page can seed the composer once (the Kitchen's day picker: "For Tue 8 Dec: "); taken, then cleared.
	$effect(() => {
		const draft = shell?.chatDraft;
		if (!draft) return;
		text = draft;
		shell.chatDraft = null;
		queueMicrotask(() => document.getElementById('chat-text')?.focus());
	});
	let busy = $state(false);
	/** The working turn's own words for what it is doing ("Writing a 3-course menu for 20, about 15 s"). */
	let status = $state<string | null>(null);
	let error = $state<string | null>(null);

	/** The page plan's name, for the header before the plan has a task. */
	let planTitle = $state('');
	/** The kitchen's newest task when the dock is on another plan's: offered, never opened by itself. */
	let earlier = $state<string | null>(null);

	function read(k = key()): string | null {
		try {
			return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(k);
		} catch {
			return null;
		}
	}
	function remember(id: string | null) {
		try {
			if (id) {
				sessionStorage.setItem(key(), id);
				sessionStorage.setItem(kitchenKey(), id);
			} else sessionStorage.removeItem(key());
		} catch {
			/* storage blocked: the task lives for this page only */
		}
	}

	/**
	 * On opening (and on a kitchen switch): the remembered task's cards as they are now, read from its plans, so an
	 * approval made on the Kitchen screen meanwhile shows up and an old card never lingers.
	 */
	/**
	 * Focus hand-off: opening moves focus into the composer; Escape closes; closing returns focus to whatever opened
	 * the dock (a header button, "Ask the agent"), so keyboard and screen-reader users never lose their place.
	 */
	let dockEl = $state<HTMLElement | null>(null);
	let opener: HTMLElement | null = null;
	let wasOpen = false;
	$effect(() => {
		const now = open;
		if (now === wasOpen) return;
		wasOpen = now;
		if (now) {
			opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			void tick().then(() => {
				const fields = dockEl?.querySelectorAll<HTMLElement>(
					'textarea, input[type="text"], input:not([type])'
				);
				fields?.[fields.length - 1]?.focus();
			});
		} else if (opener && document.contains(opener)) {
			opener.focus();
			opener = null;
		}
	});
	function onDockKey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || e.defaultPrevented || !open) return;
		if (!dockEl?.contains(document.activeElement)) return;
		if (pinned && window.matchMedia('(min-width: 1024px)').matches) return;
		e.preventDefault();
		open = false;
	}

	let loadedFor: string | null = null;
	$effect(() => {
		const k = `${kitchenId}:${planId ?? ''}:${openTask ?? ''}`;
		if (!open && !pinned && !full) return;
		if (loadedFor === k) return;
		loadedFor = k;
		untrack(() => {
			const was = { taskId, entries };
			taskId = openTask ?? read();
			if (openTask) remember(openTask);
			entries = [];
			planTitle = '';
			fresh = false;
			const before = read(kitchenKey());
			earlier = planId && !openTask && before && before !== taskId ? before : null;
			if (taskId) void restore(taskId, was.taskId === taskId ? was.entries : []);
			else if (planId) void forPlan(planId);
		});
	});

	/** A dock opened on a page's plan: the task that holds it, or none yet (the header names the plan). */
	async function forPlan(id: string) {
		try {
			const res = await fetch(`/api/chat/task?planId=${encodeURIComponent(id)}`);
			if (!res.ok) return;
			const v = (await res.json()) as { taskId: string | null; title: string; events: ChatEvent[] };
			if (planId !== id || taskId) return;
			planTitle = v.title;
			if (v.taskId) {
				taskId = v.taskId;
				remember(v.taskId);
				entries = v.events.map((e) => ({ kind: 'event', e }));
			}
		} catch {
			/* offline: the next turn joins the plan's task */
		}
	}

	/** The kitchen's earlier conversation, opened on request. */
	function openEarlier() {
		if (!earlier) return;
		taskId = earlier;
		earlier = null;
		fresh = true;
		entries = [];
		void restore(taskId);
	}

	async function restore(id: string, kept: Entry[] = []) {
		try {
			const res = await fetch(`/api/chat/task?id=${encodeURIComponent(id)}`);
			if (!res.ok) return;
			const { events } = (await res.json()) as { events: ChatEvent[] };
			const done = events.at(-1);
			if (done?.type === 'done' && done.state === 'failed') {
				newTask();
				return;
			}
			// What happened on the page while the dock was closed ("You approved 7 lines.") stays: it is not in the task.
			if (taskId === id)
				entries = [
					...events.map((e): Entry => ({ kind: 'event', e })),
					...kept.filter((x) => x.kind === 'system')
				];
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
		if (!id || id === planId || !(open || pinned || full) || id === ownFor) return;
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
	const ownNames = $derived(
		new Map(
			(ownSnap?.plan.lines ?? []).map((l) => [
				l.productId,
				readableName(l.productName ?? l.productId)
			])
		)
	);
	/** Each line's own decision (D23), as the page reads it: Accept / Reject per pending line, Accept all. */
	const lineDecided = $derived(
		lineDecisions(ownSnap?.plan.lines ?? [], ownSnap?.approvals, ownSnap?.approval ?? null)
	);
	const pendingLines = $derived(
		(ownSnap?.plan.lines ?? []).filter((l) => lineDecided.get(l.id)?.state === 'pending')
	);
	const dockAll = $derived(acceptAll(ownSnap?.plan.lines ?? [], lineDecided));
	const approvedOpen = $derived(
		(ownSnap?.plan.lines ?? []).filter(
			(l) => l.state !== 'committed' && l.view?.committable === true
		)
	); /** One way on at every door (D23): "Order 1 line now · €9.44", or what may be ordered when the dock can't count it. */
	const orderWords = $derived(
		approvedOpen.length
			? `Order ${approvedOpen.length} ${approvedOpen.length === 1 ? 'line' : 'lines'} now · ${money(
					approvedOpen.reduce((t, l) => t + (l.lineCents ?? 0), 0)
				)}`
			: 'Order what may be ordered now'
	);
	/** The dock's own order button is showing for the last decision: no second button below the answer. */
	const dockOrders = $derived(
		!!ownSnap && !pendingLines.length && approvedOpen.length > 0 && !own?.lastCommit
	);

	/**
	 * The page and the dock stay in step: when the task's plans change outside this chat (the chef approves or keeps
	 * lines held on the Kitchen page, an order lands, a change voids an approval), the dock says so in one plain
	 * line and re-reads the task, so its cards, outcome line and Continue are current. No chat turn, no model call.
	 */
	const taskPlans = $derived(
		new Set(
			entries.flatMap((x) =>
				x.kind !== 'event'
					? []
					: x.e.type === 'decision'
						? [x.e.planId]
						: x.e.type === 'ledger'
							? x.e.ledger.needs.map((n) => n.planId)
							: []
			)
		)
	);
	$effect(() => {
		if (!shell || !taskId) return;
		return shell.events.subscribe((b) => void outside(b.ops, b.resync));
	});
	/** The newest event of a type, to append only what changed. */
	const lastOfType = (t: string) =>
		entries.findLast((x) => x.kind === 'event' && x.e.type === t) as
			Extract<Entry, { kind: 'event' }> | undefined;
	const sameAs = (e: ChatEvent) => {
		const prev = lastOfType(e.type)?.e;
		if (!prev) return false;
		const key = (x: ChatEvent) =>
			x.type === 'decision'
				? `${x.approvalId}|${x.decisions.map((d) => d.key).join(',')}`
				: x.type === 'ledger'
					? `${x.summary}|${x.ledger.decisionsLeft}|${x.ledger.receiptIds.length}`
					: x.type === 'done'
						? `${x.state}|${x.canContinue}|${x.text}`
						: JSON.stringify(x);
		return key(prev) === key(e);
	};
	async function outside(ops: OpEnvelope[], resync = false) {
		const mine = ops.filter((o) => {
			const p = planOf(o.op);
			return p !== null && taskPlans.has(p) && !fromChat(o);
		});
		// Nothing of this task's, but the stream reopened or the run changed: re-read quietly, no line.
		if ((!mine.length && !resync) || busy) return;
		const id = taskId;
		const line = describeOps(mine);
		void own?.retry();
		let fresh: ChatEvent[] = [];
		try {
			const r = await fetch(`/api/chat/task?id=${encodeURIComponent(id ?? '')}`);
			if (r.ok) fresh = ((await r.json()) as { events: ChatEvent[] }).events;
		} catch {
			/* offline: the line still says what happened */
		}
		if (taskId !== id) return;
		// The lines a decision card showed before and after the re-read: what the page decided, even when the stream
		// only said to re-read (a reconnect or another instance) and carried no ops to narrate.
		const pendingIn = (es: readonly ChatEvent[]) =>
			new Set(
				es.flatMap((e) =>
					e.type === 'decision' ? e.decisions.flatMap((d) => d.lines.map((l) => l.id)) : []
				)
			);
		const before = pendingIn(
			entries.flatMap((x) => (x.kind === 'event' && x === lastDecision ? [x.e] : []))
		);
		const after = pendingIn(fresh);
		const decided = [...before].filter((l) => !after.has(l)).length;
		const said =
			line ??
			(decided ? `You decided ${decided} ${decided === 1 ? 'line' : 'lines'} on the page.` : null);
		const add: Entry[] = said ? [{ kind: 'system', text: said, at: Date.now() }] : [];
		for (const e of fresh)
			if ((e.type === 'decision' || e.type === 'ledger' || e.type === 'done') && !sameAs(e))
				add.push({ kind: 'event', e, at: Date.now() });
		// A decided card leaves the dock: only the task's current decision stays (D21 still binds the shown one).
		const stale = fresh.length > 0 && (decided > 0 || add.some((x) => x.kind === 'event'));
		if (add.length || stale)
			entries = [
				...(stale
					? entries.filter((x) => !(x.kind === 'event' && x.e.type === 'decision'))
					: entries),
				...add
			];
	}

	/**
	 * The phone sheet has a definite height, so the decisions and the history each scroll inside their share and
	 * the composer stays in reach: three quarters of the screen, never taller than what is visible, and lifted
	 * above the on-screen keyboard (the visual viewport says how much it covers). While typing, the decisions fold
	 * away so the history and the composer keep the room.
	 */
	let keyboard = $state(0);
	let visible = $state<number | null>(null);
	let composing = $state(false);
	let unfoldTimer: ReturnType<typeof setTimeout> | undefined;
	// Typing (focus with text in the box) or a running turn folds the rail's decisions to one line, so the
	// conversation keeps the room. Focus alone never does: after "plan it" the decisions must be reachable at once.
	$effect(() => {
		if (!shell) return;
		shell.railFolded = (composing && text.trim().length > 0) || busy;
		return () => {
			if (shell) shell.railFolded = false;
		};
	});
	const sheetH = $derived(
		visible === null
			? 'min(75dvh, calc(100dvh - 3rem))'
			: `${Math.round(Math.min(visible * 0.75 + (keyboard ? visible * 0.25 : 0), visible - 48))}px`
	);
	$effect(() => {
		const vv = typeof window === 'undefined' ? null : window.visualViewport;
		if (!vv) return;
		const fit = () => {
			keyboard = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
			visible = vv.height;
		};
		fit();
		vv.addEventListener('resize', fit);
		vv.addEventListener('scroll', fit);
		return () => {
			vv.removeEventListener('resize', fit);
			vv.removeEventListener('scroll', fit);
		};
	});

	/** Drag the rail's left edge: the width follows the pointer, kept within the rail's limits. */
	function startResize(e: PointerEvent) {
		if (!shell) return;
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const move = (m: PointerEvent) => shell.setRailWidth(window.innerWidth - m.clientX);
		const up = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
		e.preventDefault();
	}

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
		// The newest title: after a switch the dock is about the new task.
		for (const x of entries.toReversed())
			if (x.kind === 'event' && 'title' in x.e && typeof x.e.title === 'string' && x.e.title)
				return x.e.title;
		const said = entries.find((x) => x.kind === 'chef');
		if (said?.kind === 'chef') return said.text;
		const l = entries.findLast((x) => x.kind === 'event' && x.e.type === 'ledger');
		const labels =
			l?.kind === 'event' && l.e.type === 'ledger' ? l.e.ledger.needs.map((n) => n.label) : [];
		return labels.length ? labels.slice(0, 3).join(', ') : planTitle || 'Your task';
	});
	const doneLine = $derived(last?.kind === 'event' && last.e.type === 'done' ? last.e : undefined);

	async function turn(body: ChatTurnInput, said?: string) {
		if (busy) return;
		busy = true;
		status = null;
		error = null;
		if (said) entries = [...entries, { kind: 'chef', text: said, at: Date.now() }];
		try {
			const res = await fetch('/api/chat/turn', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					...body,
					// The page's plan rides along: a remembered task with nothing of its own gives way to it.
					...(taskId ? { taskId } : {}),
					...(planId && !fresh ? { planId } : {}),
					// No kitchen named: the server uses the visitor's own, never a default sample.
					...(kitchenId ? { kitchenId } : {})
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
					// What the turn is doing now: shown while it works, not kept in the transcript.
					if (e.type === 'status') {
						status = e.text;
						continue;
					}
					if (e.taskId && e.taskId !== taskId) {
						// The words started another task: the conversation stays, the old task's decision, menu and
						// ledger cards leave with it (they act on the old task).
						if (taskId)
							entries = entries.filter(
								(x) => x.kind !== 'event' || !['decision', 'menu', 'ledger'].includes(x.e.type)
							);
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

	// "New order" (D31): a page asks for a fresh conversation; the earlier task stays with its plan.
	let newSeen = 0;
	$effect(() => {
		const n = shell?.chatNew ?? 0;
		if (n === newSeen) return;
		newSeen = n;
		untrack(newTask);
		if (full) void tick().then(focusComposer);
	});
	/**
	 * The page mode fills what is left of the screen below the page's intro, so the composer is always in view without
	 * scrolling (D23 addendum); re-measured on resize. On load the composer takes the focus.
	 */
	let fullH = $state<number | null>(null);
	$effect(() => {
		if (!full || !dockEl) return;
		const el = dockEl;
		const fit = () => {
			const top = el.getBoundingClientRect().top + window.scrollY;
			fullH = Math.max(300, Math.round(window.innerHeight - top - 12));
		};
		fit();
		const t = setTimeout(fit, 400);
		window.addEventListener('resize', fit);
		void tick().then(focusComposer);
		return () => {
			clearTimeout(t);
			window.removeEventListener('resize', fit);
		};
	});
	function focusComposer() {
		document.getElementById('chat-text')?.focus({ preventScroll: true });
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
		(open || !launcher || full) && 'hidden'
	]}
	onclick={() => (open = true)}
>
	<MessageSquare size={16} /> Ask the agent
</button>

<svelte:window onkeydown={onDockKey} />

<aside
	class={full
		? 'mx-auto mb-3 flex w-full max-w-[880px] flex-col rounded-xl border border-rule-strong bg-sheet max-sm:rounded-none max-sm:border-x-0'
		: [
				'fixed inset-x-0 bottom-[var(--kb,0px)] z-40 flex h-[var(--sheet-h)] flex-col rounded-t-xl border-t border-rule-strong bg-sheet shadow-lg lg:inset-x-auto lg:top-11 lg:right-0 lg:bottom-0 lg:h-auto lg:w-[var(--rail-w)] lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-none',
				!open && (pinned ? 'max-lg:hidden' : 'hidden'),
				!pinned && 'lg:shadow-[-12px_0_32px_-16px_oklch(0.2_0.02_255/0.35)]'
			]}
	aria-label="Agent chat"
	bind:this={dockEl}
	style="--rail-w: {shell?.railWidth ?? 384}px; --sheet-h: {sheetH}; --kb: {keyboard}px{full &&
	fullH
		? `; height: ${fullH}px`
		: ''}"
>
	<!-- The rail's left edge: drag it, or use the arrow keys, to make the rail wider or narrower (desktop). -->
	<!-- A focusable separator is the WAI-ARIA window splitter: interactive by design. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		class={[
			'absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize hover:bg-accent/20 focus-visible:bg-accent/30 focus-visible:outline-none',
			!full && 'lg:block'
		]}
		role="separator"
		aria-orientation="vertical"
		aria-label="Resize the agent rail"
		aria-valuemin={RAIL.min}
		aria-valuemax={RAIL.max}
		aria-valuenow={shell?.railWidth ?? RAIL.default}
		tabindex="0"
		onpointerdown={startResize}
		onkeydown={(e) => {
			if (!shell) return;
			if (e.key === 'ArrowLeft') shell.setRailWidth(shell.railWidth + 16);
			else if (e.key === 'ArrowRight') shell.setRailWidth(shell.railWidth - 16);
			else return;
			e.preventDefault();
		}}
	></div>
	<header class="flex items-center gap-2 border-b border-rule px-4 py-3">
		<Bot size={18} class="text-accent" />
		<div class="min-w-0 flex-1">
			<p class="text-body font-semibold">Purchasing agent</p>
			<p class="truncate text-meta text-ink-3">
				{#if taskId}{taskTitle}<span class="sys-only mono">
						· {taskId}</span
					>{:else if planTitle}{planTitle}{:else}Plans and orders within your mandate. Never
					approves.{/if}
			</p>
			{#if earlier}
				<button type="button" class="text-micro text-accent-ink underline" onclick={openEarlier}
					>Earlier conversation</button
				>
			{/if}
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
			class={['rounded p-1 text-ink-3 hover:bg-well', pinned && 'lg:hidden', full && 'hidden']}
			aria-label="Close chat"
			onclick={() => (open = false)}><ChevronDown size={16} /></button
		>
	</header>

	{#if shell?.railHeader}
		<!-- The page's own decisions, once, at the top of the rail: the same cards and command as the page. -->
		<!-- The panel inside is the "Decide" region (its heading names it); this is only its scroll box. -->
		<!-- At most about a third of the rail: the chat history keeps the rest. -->
		<div
			class="max-h-[35%] shrink-0 overflow-y-auto overscroll-contain border-b border-rule bg-paper px-3 py-2"
		>
			{@render shell.railHeader()}
		</div>
	{/if}
	<ol
		bind:this={list}
		class="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 text-body"
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
				{:else if x.kind === 'system'}
					<!-- Something that happened on the page or the supplier, not a chat turn. -->
					<li class="flex items-start gap-1.5 text-meta text-ink-2" role="status">
						<RefreshCw size={13} class="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
						<span>{x.text}</span>
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
					{@const names = new Map(
						Object.entries(x.e.names).map(([id, n]) => [id, readableName(n)])
					)}
					{@const here = x.e.planId === planId}
					{#if here && shell?.railHeader}
						<li class="text-meta text-ink-2">
							{x.e.decisions.length}
							{x.e.decisions.length === 1 ? 'decision waits' : 'decisions wait'} above.
						</li>
					{:else if x === lastDecision && !here && ownSnap}
						<!-- D13: the chef decides here, with the page's own card and command. -->
						<li class="space-y-2" aria-label="Decide here">
							{#if pendingLines.length}
								<!-- D23: line by line, the page's own rows and command; sign-off lines confirm their terms. -->
								<ul class="divide-y divide-rule rounded-md border border-rule bg-sheet">
									{#each pendingLines as l (l.id)}
										{@const d = lineDecided.get(l.id)!}
										<LineRow
											line={l}
											name={ownNames.get(l.productId) ?? readableName(l.productId)}
											decide={{
												...d,
												cost: 'this line is not ordered',
												busy: own?.busy,
												onaccept: () =>
													void own!.decideLines(
														[{ approval: d.approval, lineIds: [l.id] }],
														'grant'
													),
												onreject: () =>
													void own!.decideLines([{ approval: d.approval, lineIds: [l.id] }], 'deny')
											}}
										/>
									{/each}
								</ul>
								{#if dockAll.count}
									<button
										type="button"
										class="w-full rounded-md bg-accent px-3 py-2 text-body font-semibold text-sheet hover:bg-accent-ink disabled:opacity-50"
										disabled={own?.busy}
										onclick={() => void own!.decideLines([...dockAll.byApproval.values()], 'grant')}
										>Accept all {dockAll.count} ·
										<span class="mono">{money(dockAll.cents)}</span></button
									>
								{/if}
							{/if}
							{#if !pendingLines.length && approvedOpen.length && !own?.lastCommit}
								<button
									type="button"
									class="w-full rounded-md bg-accent px-3 py-2 text-body font-semibold text-sheet hover:bg-accent-ink disabled:opacity-50"
									disabled={own?.busy}
									onclick={() => own!.commit()}>{orderWords}</button
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
							<p class="text-meta text-ink-3">Approve it on its card, or say “approve all” here.</p>
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
					{:else if x === last && !actedHere && x.e.canContinue && !dockOrders}
						<li class="flex flex-wrap gap-2">
							<button
								type="button"
								class="rounded-md border border-accent px-3 py-1.5 text-meta font-semibold text-accent-ink hover:bg-accent-wash disabled:opacity-50"
								disabled={busy}
								onclick={() => turn({ continue: true }, 'Continue')}
							>
								{orderWords}
							</button>
						</li>
					{/if}
				{/if}
			{/if}
		{/each}
		{#if busy}<li class="text-meta text-ink-3" role="status">
				Working · {status ?? `step ${stepsThisTurn + 1}`}…
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
	<form
		class="flex shrink-0 items-end gap-2 border-t border-rule p-3"
		onsubmit={submit}
		onfocusin={() => {
			clearTimeout(unfoldTimer);
			composing = true;
		}}
		onfocusout={() => {
			// Unfold after the click that took focus away has landed, so nothing moves under the pointer.
			clearTimeout(unfoldTimer);
			unfoldTimer = setTimeout(() => (composing = false), 300);
		}}
	>
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
