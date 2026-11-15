<script lang="ts">
	import { TriangleAlert, Info } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { storyTime } from '$lib/ui/format';
	import { useShell } from '$lib/ui/shell/shell.svelte';
	import MenuReview from '$lib/ui/request/MenuReview.svelte';
	import type { MenuChange, MenuPlanResult, MenuView } from '$lib/ui/request/types';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const EXAMPLES = [
		'1,000 L lactose-free milk by Monday',
		'200 kg potatoes Friday',
		'2 cases of butter Thursday',
		'200 portions of pasta bolognese, half beef and the other half mixed'
	];
	let kitchenId = $state('');
	$effect.pre(() => {
		if (!kitchenId) kitchenId = data.defaultKitchen;
	});
	let error = $state<string | null>(null);
	/** Until hydration an example can't reach the composer. */
	let ready = $state(false);
	/**
	 * D23: /request is the conversation, full width: the same agent, transcript and cards as the dock on every page.
	 * `?text=` puts words in its composer; an example does the same. A menu the chat proposed (`?menu=`) opens above.
	 */
	onMount(() => {
		ready = true;
		if (shell) {
			shell.chatFull = true;
			const t = new URL(location.href).searchParams.get('text');
			if (t) shell.chatDraft = t.slice(0, 500);
			// "New order" (D31): a fresh conversation; earlier orders keep their own threads.
			if (new URL(location.href).searchParams.get('new') === '1') shell.chatNew++;
		}
		void openLinkedMenu();
		return () => {
			if (shell) shell.chatFull = false;
		};
	});
	function ask(t: string) {
		if (shell) shell.chatDraft = t;
	}
	function startOver() {
		menu = null;
		menuPlan = null;
		linkedMenu = null;
	}

	/**
	 * A menu the chat proposed opens here for the chef's review: /request?menu=<id>&rev=<revision>. It is read from this
	 * browser's own workspace; a menu from another room or from before a reset is not there, and the page says so.
	 */
	let linkedMenu = $state<{ id: string; rev: number | null; note: string | null } | null>(null);
	let menu = $state.raw<MenuView | null>(null);
	let menuPlan = $state.raw<MenuPlanResult | null>(null);
	let menuBusy = $state(false);
	async function openLinkedMenu() {
		const q = new URL(location.href).searchParams;
		const id = q.get('menu');
		if (!id) return;
		const rev = q.get('rev') !== null && /^\d+$/.test(q.get('rev')!) ? Number(q.get('rev')) : null;
		linkedMenu = { id, rev, note: null };
		try {
			const res = await fetch('/request/menu', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'read', id })
			});
			if (!res.ok) {
				linkedMenu = {
					id,
					rev,
					note: "This menu isn't in this sandbox: it was proposed in another room or before a reset. Ask the chat to propose it again here."
				};
				return;
			}
			menu = (await res.json()) as MenuView;
			if (rev !== null && menu.proposal.revision !== rev)
				linkedMenu = {
					id,
					rev,
					note: `The chat linked revision ${rev}; this is the latest, revision ${menu.proposal.revision}.`
				};
		} catch (e) {
			linkedMenu = { id, rev, note: e instanceof Error ? e.message : String(e) };
		}
	}
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
	}

	/** Sandboxes only (own or shared room): a fresh run with the seed kitchens; the old run stays for audit. */
	let sandboxNote = $state<string | null>(null);
	let resetting = $state(false);
	async function resetSandbox() {
		resetting = true;
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
			resetting = false;
		}
	}

	// The shell shows where the data comes from and the sandbox (workspace, run, clock, start over).
	const shell = useShell();
	$effect(() => {
		if (!shell) return;
		shell.labels = { source: null, offline: false };
		shell.sandbox = {
			workspace: data.workspace.id,
			run: data.workspace.run,
			clock: storyTime(data.now),
			busy: resetting,
			onReset: resetSandbox
		};
		// The conversation acts for the kitchen chosen here.
		shell.chat = { kitchenId: kitchenId || undefined };
		return () => {
			shell.labels = null;
			shell.sandbox = null;
			shell.chat = {};
		};
	});
</script>

<svelte:head><title>Ask the agent · Mandate</title></svelte:head>

<main class="mx-auto max-w-[880px] px-4 pt-6 sm:pt-10">
	<header class="mb-4 flex flex-wrap items-end justify-between gap-3">
		<div>
			<p class="text-meta font-medium tracking-[0.08em] text-ink-3 uppercase">
				Mandate · ask the agent
			</p>
			<h1 class="mt-1 text-title leading-tight font-semibold tracking-[-0.01em] sm:text-display">
				What does the kitchen need?
			</h1>
			<p class="mt-1 text-body text-ink-2">
				Say it in your words, English or Finnish. The agent plans and prices it within your mandate;
				anything over it waits for you.
			</p>
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

	{#if data.workspace.notice}
		<p
			class="mb-2 flex items-center gap-2 rounded-md border border-signoff/40 bg-signoff-wash px-3 py-2 text-body text-ink"
			role="note"
			data-testid="room-notice"
		>
			<Info size={15} class="shrink-0 text-signoff" aria-hidden="true" />{data.workspace.notice}
		</p>
	{/if}

	<div class="mb-3 flex flex-wrap items-center gap-2" aria-label="Examples">
		<span class="text-meta text-ink-3">Try</span>
		{#each EXAMPLES as ex (ex)}
			<button
				type="button"
				disabled={!ready}
				onclick={() => ask(ex)}
				class="h-8 rounded-full border border-rule-strong bg-sheet px-3 text-body text-ink-2 hover:border-accent/50 hover:text-accent-ink disabled:opacity-50"
				>{ex}</button
			>
		{/each}
	</div>

	{#if error}
		<p
			class="mb-3 flex items-start gap-2 rounded-lg border border-out/30 bg-out-wash px-3 py-2 text-body text-out"
			role="alert"
		>
			<TriangleAlert size={16} class="mt-0.5 shrink-0" aria-hidden="true" />{error}
		</p>
	{/if}

	{#if linkedMenu}
		<section class="mb-6" aria-label="Menu from the chat" data-testid="linked-menu">
			<h2 class="text-heading font-semibold">Menu from the chat</h2>
			{#if linkedMenu.note}<p class="mt-1 text-body text-ink-2" role="status">
					{linkedMenu.note}
				</p>{/if}
			{#if menu}
				<MenuReview
					view={menu}
					busy={menuBusy}
					plan={menuPlan}
					onchange={editMenu}
					onaccept={acceptMenu}
					onplan={planMenu}
				/>
			{:else if !linkedMenu.note}
				<p class="mt-1 text-body text-ink-3">Opening the menu…</p>
			{/if}
		</section>
	{/if}
	<!-- The conversation itself is the app shell's agent, rendered below in the page's flow (shell.chatFull). -->
</main>
