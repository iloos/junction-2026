<script lang="ts">
	import { ArrowRight, TriangleAlert, Info } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { storyTime } from '$lib/ui/format';
	import { useShell } from '$lib/ui/shell/shell.svelte';
	import MenuReview from '$lib/ui/request/MenuReview.svelte';
	import RequestFlow from '$lib/ui/request/RequestFlow.svelte';
	import type { MenuChange, MenuPlanResult, MenuView, RequestResult } from '$lib/ui/request/types';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const EXAMPLES = [
		'1,000 L lactose-free milk by Monday',
		'200 kg potatoes Friday',
		'2 cases of butter Thursday',
		'200 portions of pasta bolognese, half beef and the other half mixed'
	];
	const PLACEHOLDER = EXAMPLES[0];

	let text = $state('');
	let kitchenId = $state('');
	$effect.pre(() => {
		if (!kitchenId) kitchenId = data.defaultKitchen;
	});
	const newNonce = () => (crypto.randomUUID?.() ?? String(Math.random())).slice(0, 12);
	/** The request being worked: new words mount a new flow; edits happen inside it. */
	let submitted = $state.raw<{ text: string; nonce: string; key: number } | null>(null);
	let result = $state.raw<RequestResult | null>(null);
	let error = $state<string | null>(null);
	/** Until hydration the form would submit natively and lose the text. */
	let ready = $state(false);
	onMount(() => {
		ready = true;
		void openLinkedMenu();
	});

	function submit(t: string) {
		const req = t.trim() || PLACEHOLDER;
		text = req;
		result = null;
		submitted = { text: req, nonce: newNonce(), key: (submitted?.key ?? 0) + 1 };
	}

	function startOver() {
		submitted = null;
		result = null;
		text = '';
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
	const valioSource = $derived.by(() => {
		const lookup = result?.lookup;
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
			busy: resetting,
			onReset: resetSandbox
		};
		// The agent dock follows this request: its kitchen, and the plan it produced once there is one.
		shell.chat = {
			kitchenId: result?.order?.plan.kitchenId ?? (kitchenId || undefined),
			planId: result?.order?.plan.id
		};
		return () => {
			shell.labels = null;
			shell.sandbox = null;
			shell.chat = {};
		};
	});
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

	{#if data.workspace.notice}
		<p
			class="mb-2 flex items-center gap-2 rounded-md border border-signoff/40 bg-signoff-wash px-3 py-2 text-body text-ink"
			role="note"
			data-testid="room-notice"
		>
			<Info size={15} class="shrink-0 text-signoff" aria-hidden="true" />{data.workspace.notice}
		</p>
	{/if}
	<form
		class="rounded-xl border border-rule-strong bg-sheet p-2 shadow-[0_1px_0_oklch(0.9_0.01_85)] focus-within:border-accent/60"
		onsubmit={(e) => {
			e.preventDefault();
			submit(text);
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
					submit(text);
				}
			}}></textarea>
		<div class="flex items-center justify-between gap-2 px-1 pt-1">
			<span class="hidden px-1.5 text-meta text-ink-3 sm:inline"
				>English or Finnish. Quantity, product, day.</span
			>
			<button
				type="submit"
				disabled={!ready}
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
				disabled={!ready}
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

	{#if linkedMenu && !submitted}
		<section class="mt-8" aria-label="Menu from the chat" data-testid="linked-menu">
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

	{#if submitted}
		{#key submitted.key}
			<RequestFlow
				text={submitted.text}
				{kitchenId}
				nonce={submitted.nonce}
				now={data.now}
				onresult={(r) => (result = r)}
				onnew={startOver}
			/>
		{/key}
	{/if}
</main>
