<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import {
		ArrowLeft,
		ArrowDown,
		ArrowUpRight,
		Check,
		ChevronRight,
		LayoutGrid,
		Hand,
		LoaderCircle,
		MessageCircle,
		Search,
		SlidersHorizontal,
		X
	} from '@lucide/svelte';
	import Board from '$lib/canvas/Board.svelte';
	import ProductRow from '$lib/canvas/ProductRow.svelte';
	import ProductToken from '$lib/ui/ProductToken.svelte';
	import { projectCanvas, type CanvasItem } from '$lib/canvas/model';
	import { KitchenStore } from '$lib/kitchen/kitchen.svelte';
	import { call, TAB, ToolError } from '$lib/kitchen/api';
	import { errorWords } from '$lib/kitchen/error-words';
	import { useShell } from '$lib/ui/shell/shell.svelte';
	import { planOf, productOf } from '$lib/ui/shell/plan-events.svelte';
	import { money, qty, qtyWords, readableName, day } from '$lib/ui/format';
	import { marksTitle, CODE_WORDS, type MenuCode } from '$lib/ui/diet';
	import DietMarks from '$lib/ui/DietMarks.svelte';
	import GramsStepper from '$lib/ui/GramsStepper.svelte';
	import DecisionCard from '$lib/ui/DecisionCard.svelte';
	import { decisionsOf } from '$lib/ui/decisions';
	import { reasonLong } from '$lib/ui/reasons';
	import type { CandidateView } from '$lib/kitchen/view-model';

	const k = new KitchenStore('live');
	const shell = useShell();
	let selected = $state<string | null>(null);
	let query = $state('');
	let filter = $state('all');
	let diet = $state('all');
	let compact = $state(false);
	let filtersOpen = $state(true);
	let workbenchEl = $state<HTMLElement | null>(null);
	let workbenchHeight = $state(600);
	let notice = $state('');
	let recommendError = $state('');
	let refreshPending = $state(false);
	let reopenPending = $state(false);
	let seenPlan = '';
	let openedTarget: string | null | undefined;
	let detailOpen = $state(false);
	let locatedAt = 0;
	let focusedLink: string | null = null;

	const missingPlan = $derived(
		k.linkMissing ||
			(!!page.url.searchParams.get('plan') &&
				k.started !== null &&
				!k.busy &&
				page.url.searchParams.get('plan') !== k.plan?.id)
	);
	const graph = $derived(k.snap && !missingPlan ? projectCanvas(k.snap) : null);
	const item = $derived(graph?.items.find((i) => i.id === selected));
	const pending = $derived(k.plan ? decisionsOf(k.plan, k.snap?.approval) : []);
	const itemDecisions = $derived(
		pending.filter((d) => item?.lines.some((l) => d.lineIds.includes(l.id)))
	);
	const names = $derived(
		new Map(graph?.lines.map((l) => [l.productId, readableName(l.name)]) ?? [])
	);
	const groups = $derived(
		graph?.groups
			.map((g) => ({ ...g, items: g.items.filter(matches) }))
			.filter((g) => g.items.length) ?? []
	);
	const visibleCount = $derived(groups.reduce((n, g) => n + g.items.length, 0));
	const activeFilters = $derived(
		Number(filter !== 'all') + Number(diet !== 'all') + Number(compact)
	);

	function matches(i: CanvasItem) {
		const text = [i.label, ...i.lines.map((l) => l.name)].join(' ').toLocaleLowerCase();
		if (query.trim() && !text.includes(query.trim().toLocaleLowerCase())) return false;
		if (filter === 'shortfall' && i.status !== 'partial' && i.status !== 'shortfall') return false;
		if (
			filter === 'decision' &&
			!pending.some((d) => i.lines.some((l) => d.lineIds.includes(l.id)))
		)
			return false;
		if (filter === 'replacement' && !i.lines.some((l) => l.substituteFor)) return false;
		if (
			diet !== 'all' &&
			(!i.currentLines.length ||
				!i.currentLines.every((l) => l.marks.codes.includes(diet as MenuCode)))
		)
			return false;
		return true;
	}

	$effect(() => {
		const plan = page.url.searchParams.get('plan');
		if (k.busy || openedTarget === plan) return;
		openedTarget = plan;
		untrack(() => {
			if (!plan) {
				k.linkMissing = null;
				k.focusedPlan = null;
			}
			void k.load(plan ?? undefined);
		});
	});
	$effect(() => {
		const identity = `${k.snap?.clock.runId ?? ''}:${k.plan?.id ?? ''}`;
		if (identity === seenPlan || !graph) return;
		seenPlan = identity;
		const target = page.url.searchParams.get('need');
		selected =
			graph.items.find((i) => i.id === target)?.id ??
			graph.items.find((i) => i.status === 'partial' || i.status === 'shortfall')?.id ??
			graph.items[0]?.id ??
			null;
		query = '';
		filter = 'all';
		diet = 'all';
		notice = '';
	});
	$effect(() => {
		const need = page.url.searchParams.get('need');
		if (!need) {
			focusedLink = null;
			return;
		}
		if (!graph) return;
		const key = `${graph.planId}:${need}`;
		if (key === focusedLink) return;
		focusedLink = key;
		if (graph.items.some((i) => i.id === need)) untrack(() => void select(need));
		else {
			selected = null;
			detailOpen = false;
			notice = 'That ingredient is no longer in this plan. Choose another ingredient to explore.';
		}
	});

	$effect(() => {
		if (!shell) return;
		shell.kitchen = missingPlan ? null : k;
		shell.chat = missingPlan
			? {}
			: { kitchenId: k.snap?.kitchen.id ?? k.startKitchen ?? undefined, planId: k.plan?.id };
		return () => {
			if (shell.kitchen === k) {
				shell.kitchen = null;
				shell.chat = {};
			}
		};
	});
	$effect(() => {
		const request = shell?.locate;
		if (!request || request.at === locatedAt || request.planId !== graph?.planId) return;
		locatedAt = request.at;
		if (request.zone === 'order') {
			void goto(resolve(`/?plan=${encodeURIComponent(graph.planId)}#order`));
			return;
		}
		const decision = pending.find((d) => d.key === request.decision) ?? pending[0];
		if (decision) untrack(() => void focusDecision(decision.key));
	});
	$effect(() => {
		if (!shell) return;
		return shell.events.subscribe(({ ops, resync, newRun }) => {
			if (newRun) {
				reopenPending = true;
				return;
			}
			const products = new Set(k.plan?.lines.map((l) => l.productId) ?? []);
			const changed = ops.some((o) => {
				if (o.via === `kitchen#${TAB}`) return false;
				if (!k.plan && o.op.type === 'CreatePlan') return o.op.plan.kitchenId === k.startKitchen;
				return planOf(o.op) === k.plan?.id || products.has(productOf(o.op) ?? '');
			});
			if (resync || changed) refreshPending = true;
			if (changed) notice = 'Basket updated from the agent or another screen.';
		});
	});
	// Bursts arriving during a command wait until its snapshot is visible, rather than being dropped.
	$effect(() => {
		if (k.busy) return;
		if (reopenPending) {
			reopenPending = false;
			refreshPending = false;
			untrack(() => void k.reopen());
		} else if (refreshPending) {
			refreshPending = false;
			untrack(() => void k.refreshFrom('outside'));
		}
	});
	// Both desktop panes share the available height. Scroll position does not change their document-top anchor.
	$effect(() => {
		const el = workbenchEl;
		if (!el) return;
		const measure = () => {
			const top = el.getBoundingClientRect().top + window.scrollY;
			workbenchHeight = Math.max(480, Math.min(900, Math.floor(window.innerHeight - top - 24)));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el.parentElement ?? el);
		window.addEventListener('resize', measure);
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', measure);
		};
	});
	onMount(() => {
		const clock = setInterval(() => k.tick(), 1000);
		const wide = window.matchMedia('(min-width: 768px)');
		const syncFilters = () => {
			filtersOpen = wide.matches;
		};
		syncFilters();
		wide.addEventListener('change', syncFilters);
		return () => {
			clearInterval(clock);
			wide.removeEventListener('change', syncFilters);
		};
	});

	async function select(id: string) {
		selected = id;
		recommendError = '';
		detailOpen = true;
		await tick();
		document.getElementById('ingredient-inspector')?.scrollTo({ top: 0 });
		if (window.matchMedia('(max-width: 767px)').matches) {
			document.getElementById('ingredient-heading')?.focus({ preventScroll: true });
			document
				.getElementById('ingredient-inspector')
				?.scrollIntoView({ block: 'start', behavior: 'instant' });
		}
	}
	async function closeIngredient() {
		const id = selected;
		selected = null;
		detailOpen = false;
		await tick();
		if (id)
			document.querySelector<HTMLButtonElement>(`[data-need-id="${CSS.escape(id)}"]`)?.focus();
	}
	async function focusDecision(key?: string) {
		const decision = pending.find((d) => d.key === key) ?? pending[0];
		const target = graph?.items.find((i) => i.lines.some((l) => decision?.lineIds.includes(l.id)));
		if (!target || !decision) {
			await goto(resolve(`/?plan=${encodeURIComponent(graph?.planId ?? '')}#approval`));
			return;
		}
		await select(target.id);
		await tick();
		const card = document.getElementById(`canvas-decision-${decision.key}`);
		card?.scrollIntoView({ block: 'start', behavior: 'instant' });
		card?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
	}
	function ask(option?: CandidateView, replace = false) {
		if (!shell || !item) return;
		const group = graph?.groups.find((g) => g.items.some((i) => i.id === item.id));
		shell.chatDraft =
			`For ${item.label}${group?.dishId ? ` in ${group.label}` : ''} in this plan, ${replace ? 'find and apply a suitable replacement recommendation, then show any decisions for my review.' : option ? `compare ${readableName(option.name)} with the current purchases and explain any quantity, diet or approval differences.` : 'explain the current purchases and compare suitable alternatives.'}`.slice(
				0,
				500
			);
		shell.chatOpen = true;
	}
	function comparisonPrice(candidate: CandidateView) {
		const price = item?.lines.find((l) => l.productId === candidate.productId)?.line.view
			?.comparisonPrice;
		if (price) return `${money(price.cents)}/${price.per}`;
		if (candidate.unit === 'KG' && candidate.perKgCents !== null)
			return `${money(candidate.perKgCents)}/kg`;
		return 'Open product details for pack price';
	}
	async function recommend() {
		if (k.readOnly || missingPlan || !item?.dish?.plannedLineId || !k.plan) return;
		const input = {
			planId: k.plan.id,
			version: k.plan.version,
			lineId: item.dish.plannedLineId,
			apply: true
		};
		k.busy = true;
		recommendError = '';
		notice = '';
		try {
			const result = await call(k.mode, 'find_substitutes', input, k.rendered);
			notice = result.applied
				? 'Recommendation applied. Review the updated purchases and any decisions.'
				: result.kind === 'none'
					? 'No qualifying replacement found. The basket is unchanged.'
					: 'The basket already uses this recommendation. No changes were made.';
		} catch (e) {
			recommendError =
				e instanceof ToolError && e.error.code !== 'PROVIDER_UNAVAILABLE'
					? errorWords(e.error)
					: 'The replacement response could not be confirmed. Review the refreshed basket before retrying.';
		} finally {
			await k.retry();
		}
	}
</script>

<svelte:head><title>Basket canvas · Mandate</title></svelte:head>

<div class="canvas-page">
	<header class="canvas-heading mb-4 flex flex-wrap items-start justify-between gap-4">
		<div class="min-w-0">
			<a
				href={graph ? resolve(`/?plan=${encodeURIComponent(graph.planId)}`) : resolve('/')}
				class="mb-3 inline-flex items-center gap-1 text-meta text-accent-ink"
				><ArrowLeft size={14} /> Kitchen</a
			>
			<h1 class="text-display font-medium">Basket canvas</h1>
			<p class="mt-2 text-ink-2">
				{graph ? k.view?.title : 'Explore a plan, ingredient by ingredient.'}
			</p>
			{#if graph && k.view}<p class="mt-1 text-meta text-ink-3">
					{k.snap?.kitchen.name} · {day(k.view.date)}{k.view.title.includes(
						`${k.view.guests} guests`
					)
						? ''
						: ` · ${k.view.guests} guests`}
				</p>{/if}
		</div>
		{#if graph && k.plan}<div class="canvas-quote text-right">
				<div>
					<span class="text-meta text-ink-2">Quoted basket · ex VAT</span>
					<p class="mono mt-1 text-title tabular-nums">{money(k.plan.totalCents)}</p>
				</div>
				<a
					class="mt-2 inline-flex items-center gap-1 text-meta text-accent-ink"
					href={resolve(`/?plan=${encodeURIComponent(graph.planId)}#approval`)}
					>Review and order in Kitchen <ArrowUpRight size={14} /></a
				>
			</div>{/if}
	</header>
	{#if graph && pending.length}
		<div
			class="mb-4 flex items-start justify-between gap-4 border-t border-b border-rule py-3"
			aria-label="Basket decisions"
		>
			<div>
				<p class="flex items-center gap-2 text-meta text-signoff">
					<Hand size={16} />Waits on you · {pending.length}
					{pending.length === 1 ? 'decision' : 'decisions'}
				</p>
				<p class="mt-1 font-medium">{pending[0].title}</p>
			</div>
			<button class="btn shrink-0" disabled={k.readOnly} onclick={() => focusDecision()}
				>Review decision</button
			>
		</div>
	{/if}

	{#if notice}<p class="mb-4 flex items-start gap-2 text-meta text-accent-ink" role="status">
			<Check class="shrink-0" size={16} />{notice}
		</p>{/if}
	{#if k.stale || k.error || recommendError}
		<div
			role="alert"
			class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-out p-4"
		>
			<p>
				{k.stale
					? 'Could not refresh this basket. The last view is read-only.'
					: recommendError || errorWords(k.error!)}
			</p>
			<button
				class="btn"
				disabled={k.busy}
				onclick={() => {
					recommendError = '';
					void k.retry();
				}}>Refresh basket</button
			>
		</div>
	{/if}
	{#if missingPlan}
		<section class="max-w-xl py-8">
			<h2 class="text-title font-medium">This plan is not available</h2>
			<p class="mt-3 text-ink-2">
				It may belong to another kitchen or an earlier sandbox. Open your own basket to continue.
			</p>
			<a class="btn mt-4" href={resolve('/canvas')}>Open my basket</a>
		</section>
	{:else if k.started === null}
		<p class="flex items-center gap-2 py-12" role="status">
			<LoaderCircle size={18} class="animate-spin" /> Loading your basket…
		</p>
	{:else if !graph}
		<section class="max-w-xl py-8">
			<h2 class="text-title font-medium">Open a plan to explore it</h2>
			<p class="mt-3 text-ink-2">
				Create a menu or open an existing plan in the Kitchen, then return to its canvas.
			</p>
			<a class="btn btn-primary mt-4 inline-flex" href={resolve('/')}>Open Kitchen</a>
		</section>
	{:else}
		<div class="toolbar">
			<label class="search"
				><Search size={16} /><span class="sr-only">Find an ingredient or product</span><input
					type="search"
					bind:value={query}
					placeholder="Find ingredient or product"
				/></label
			>
			<details class="filter-controls" bind:open={filtersOpen}>
				<summary
					><SlidersHorizontal size={16} /> View filters{activeFilters
						? ` · ${activeFilters} active`
						: ''}</summary
				>
				<div class="filter-options">
					<label class="filter"
						><span class="sr-only">Show ingredients</span><select bind:value={filter}
							><option value="all">All ingredients</option><option value="shortfall"
								>Shortfalls</option
							><option value="decision">Waits on you</option><option value="replacement"
								>Replacements</option
							></select
						></label
					>
					<label class="filter"
						><span class="sr-only">Product diet claims</span><select bind:value={diet}
							><option value="all">Any diet record</option
							>{#each Object.entries(CODE_WORDS) as [code, word] (code)}<option value={code}
									>{word}</option
								>{/each}</select
						></label
					>
					<button class="btn ml-auto" aria-pressed={compact} onclick={() => (compact = !compact)}
						><LayoutGrid size={16} /> Compact</button
					>
				</div>
			</details>
		</div>
		<p class="my-3 text-meta text-ink-2">
			{visibleCount} of {graph.items.length} ingredients · Select an ingredient.
			{#if diet !== 'all'}
				Diet filters use declared product records.{/if}
		</p>
		<div class="phone-views" aria-label="Canvas view">
			<button class="btn" aria-pressed={!detailOpen} onclick={() => (detailOpen = false)}
				>Ingredients</button
			><button
				class="btn"
				aria-pressed={detailOpen}
				disabled={!item}
				onclick={() => (detailOpen = true)}>Selected ingredient</button
			>
		</div>
		<div
			bind:this={workbenchEl}
			class="workbench"
			class:details-open={detailOpen}
			style="--workbench-height: {workbenchHeight}px"
			data-workbench
		>
			<div class="board-area min-w-0">
				{#if visibleCount}<Board
						{groups}
						{selected}
						{compact}
						deliverBy={k.plan?.deliverBy}
						changed={k.flash}
						onselect={select}
					/>{:else}<div class="bg-well p-6">
						<h2 class="text-heading font-medium">No ingredients match</h2>
						<p class="mt-2 text-ink-2">Try a different name or clear the filters.</p>
						<button
							class="btn mt-4"
							onclick={() => {
								query = '';
								filter = 'all';
								diet = 'all';
							}}>Clear filters</button
						>
					</div>{/if}
				{#if graph.unlinkedLines.length}
					<section class="mt-4 border-t border-rule pt-4">
						<h2 class="text-heading font-medium">Other purchases</h2>
						<p class="mt-1 text-meta text-ink-2">These lines have no recorded ingredient link.</p>
						{#each graph.unlinkedLines as line (line.id)}<div
								class="mt-3 flex items-start justify-between gap-4"
							>
								<ProductRow
									productId={line.productId}
									name={line.name}
									cents={line.lineCents}
									quantity={qtyWords(line.qty)}
									deliverBy={k.plan?.deliverBy}
									size={40}
								/>
							</div>{/each}
					</section>
				{/if}
			</div>
			<aside id="ingredient-inspector" aria-label="Ingredient inspector" class="inspector">
				{#if item}
					<div class="inspector-title flex items-start justify-between gap-3">
						<h2 id="ingredient-heading" tabindex="-1" class="text-title font-medium">
							{item.label}
						</h2>
						<button class="icon-btn" aria-label="Close ingredient" onclick={closeIngredient}
							><X size={18} /></button
						>
					</div>
					{#if !groups.some((g) => g.items.some((i) => i.id === item.id))}<p
							class="mt-2 text-meta text-ink-2"
						>
							Selected ingredient is outside the current filters.
						</p>{/if}
					<div class="mt-4 flex items-center justify-between gap-4">
						<span class="text-ink-2">Needed</span><span class="mono tabular-nums"
							>{qty(item.amount.value, item.amount.unit)}</span
						>
					</div>
					{#if item.requirements}<p class="mt-2 text-meta text-ink-2">
							Required: {[
								...(item.requirements.freeFrom ?? []).map((s) => `${s.toLowerCase()}-free`),
								...(item.requirements.diet ?? []),
								...(item.requirements.labels ?? []),
								...(item.requirements.origin
									? [`origin ${item.requirements.origin.toUpperCase()}`]
									: []),
								...(item.requirements.excludes ?? []).map((s) => `no ${s.replaceAll('_', ' ')}`)
							].join(' · ') || 'Kitchen rules apply'}
						</p>{/if}
					{#if item.unresolved}<p class="mt-3 text-out">{item.unresolved}</p>{/if}
					{#if item.dish?.editable && item.amount.unit === 'kg'}<div
							class="mt-4 flex items-center justify-between gap-3"
						>
							<span class="text-meta text-ink-2">Grams per guest</span><GramsStepper
								value={item.dish.gServed}
								original={item.dish.gDefault}
								label={item.label}
								disabled={k.readOnly}
								onchange={(g) => k.setGrams(item.dish!.id, g)}
							/>
						</div>{/if}
					<div class="my-4 flex items-center gap-2 text-meta text-ink-3">
						<ArrowDown size={16} /> Served by these purchases
					</div>
					{#each item.lines as line (line.id)}
						<div class="purchase" class:retired={!item.currentLines.some((l) => l.id === line.id)}>
							<ProductRow
								productId={line.productId}
								name={line.name}
								cents={line.lineCents}
								quantity={`${qtyWords(line.qty)}${line.physical ? ` · ${qty(line.physical.value, line.physical.unit)}` : ''}`}
								deliverBy={k.plan?.deliverBy}
								size={96}
								eager
							/>
							<p class="mt-2 text-meta text-ink-2">
								{line.state === 'committed'
									? 'Ordered'
									: line.line.reasons.includes('superseded')
										? 'Replaced · not being bought'
										: line.line.view?.committable
											? line.state === 'eligible'
												? 'Can order now'
												: 'Approved not ordered'
											: line.line.view?.reviewable &&
												  pending.some((d) => d.lineIds.includes(line.id))
												? 'Waits on you'
												: line.state === 'unorderable' || line.state === 'rejected'
													? 'Cannot order'
													: 'Planned'}{line.substituteFor
									? ` · replaces ${names.get(line.substituteFor) ?? 'the original product'}`
									: ''}
							</p>
							{#if line.line.offer}<p class="mt-1 text-meta text-ink-2">
									Supply: {line.line.offer.availability.kind === 'known'
										? 'stock known'
										: line.line.offer.availability.kind.replaceAll('_', ' ')}
								</p>{/if}
							<div class="mt-2">
								<DietMarks marks={line.marks} />
								<p class="mt-1 text-meta text-ink-2">{marksTitle(line.marks)}</p>
							</div>
							{#if line.line.reasons.length}<details class="mt-2 text-meta">
									<summary class="cursor-pointer text-accent-ink">Why this state</summary>
									<ul class="mt-2 space-y-2">
										{#each line.line.reasons as reason (reason)}<li>{reasonLong(reason)}</li>{/each}
									</ul>
								</details>{/if}
						</div>
					{/each}
					{#if !item.lines.length}<p class="text-out">
							No product is linked yet. Ask the agent to find a suitable product.
						</p>{/if}
					<button class="btn mt-4" onclick={() => ask()}
						><MessageCircle size={16} /> Ask about this ingredient</button
					>
					{#if item.dish?.rescue}
						<section class="mt-6 border-t border-rule pt-4" aria-label="Ingredient alternatives">
							<h3 class="text-heading font-medium">Alternatives</h3>
							<p class="mt-2 text-meta text-ink-2">{item.dish.rescue.summary}</p>
							{#each item.dish.rescue.candidates as candidate (candidate.productId)}
								<details class="mt-3 border-t border-rule pt-3">
									<summary class="candidate-summary cursor-pointer text-body"
										><ChevronRight size={16} class="candidate-chevron" /><span class="min-w-0"
											><ProductRow
												productId={candidate.productId}
												name={candidate.name}
												deliverBy={k.plan?.deliverBy}
												size={48}
												inspect={false}
											/><span class="mt-1 block text-meta text-ink-2"
												>{candidate.chosen
													? 'Current purchase'
													: candidate.recommended
														? 'Agent pick'
														: 'Alternative'} · {candidate.availableText} · {comparisonPrice(
													candidate
												)}</span
											></span
										></summary
									>
									<p class="mt-3 text-meta text-ink-2">
										{candidate.whatChanges ?? candidate.verdict}
									</p>
									{#if candidate.cautionNote}<p class="mt-2 text-meta text-signoff">
											{candidate.cautionNote}
										</p>{/if}
									<div class="mt-3 text-meta">
										<span class="text-ink-2"
											>Product details:
										</span>{#key `${candidate.productId}:${k.plan?.deliverBy ?? ''}`}<ProductToken
												productId={candidate.productId}
												name={candidate.name}
												deliverBy={k.plan?.deliverBy}
												wrap
												class="underline decoration-rule-strong underline-offset-2 hover:decoration-accent [&>img]:hidden"
												>{#snippet mark()}{/snippet}</ProductToken
											>{/key}
									</div>
									{#if candidate.rejected.length}<p class="mt-2 text-meta text-out">
											{candidate.rejected.map((r) => reasonLong(r)).join(' ')}
										</p>{/if}
									<p class="mt-2 flex justify-between gap-3 text-meta">
										<span
											>{candidate.qty === null
												? 'Not sized yet'
												: qtyWords({ value: candidate.qty, unit: candidate.unit })}</span
										><span class="mono tabular-nums">{money(candidate.lineCents)}</span>
									</p>
									<button class="btn mt-3" onclick={() => ask(candidate)}
										>Ask about this option</button
									>
								</details>
							{/each}
							{#if item.lines.every((l) => l.state !== 'committed')}<button
									class="btn btn-primary mt-4"
									disabled={k.readOnly}
									onclick={recommend}>Apply agent recommendation</button
								>
								<button class="btn mt-3" onclick={() => ask(undefined, true)}
									>Ask agent to replace</button
								>
								<p class="mt-2 text-meta text-ink-2">
									A changed recommendation re-quotes the plan and voids its previous approval.
									Asking the agent opens a draft for your review.
								</p>{/if}
						</section>
					{/if}
					{#if itemDecisions.length}<section
							class="mt-6 border-t border-rule pt-4"
							aria-label="Ingredient decisions"
						>
							<h3 class="mb-3 text-heading font-medium">Shared basket decisions</h3>
							{#each itemDecisions as decision (decision.key)}<div
									id={`canvas-decision-${decision.key}`}
									class="decision-anchor"
								>
									<p class="mb-3 text-meta text-ink-2">
										Includes this ingredient. Reviewing covers all {decision.lineIds.length} listed purchases
										in this basket decision.
									</p>
									<DecisionCard
										{decision}
										{names}
										busy={k.readOnly}
										onapprove={(ids) => k.approve('grant', ids)}
										onkeep={(ids) => k.approve('deny', ids)}
										deliverBy={k.plan?.deliverBy}
										now={k.now}
									/>
								</div>{/each}
						</section>{/if}
				{:else}<div class="py-8">
						<h2 class="text-heading font-medium">Follow an ingredient</h2>
						<p class="mt-2 text-ink-2">
							Select one to see what is needed, what the basket buys, and what could replace it.
						</p>
					</div>{/if}
			</aside>
		</div>
	{/if}
</div>

<style>
	.canvas-page {
		max-width: 1600px;
		margin: 0 auto;
		padding: 24px;
	}
	.workbench {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 360px;
		gap: 24px;
		align-items: start;
		height: var(--workbench-height);
	}
	.board-area {
		height: 100%;
		min-height: 0;
		overflow: auto;
		background: var(--color-well);
		scroll-padding: 24px;
		scrollbar-gutter: stable;
		scrollbar-color: var(--color-rule-strong) transparent;
	}
	.phone-views {
		display: none;
	}
	.toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
		padding: 12px 0;
		border-top: 1px solid var(--color-rule);
		border-bottom: 1px solid var(--color-rule);
	}
	.filter-controls > summary {
		display: none;
	}
	.filter-options {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
	}
	.search,
	.filter {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.search {
		flex: 1 1 240px;
	}
	input,
	select {
		min-height: 40px;
		background: var(--color-sheet);
		color: var(--color-ink);
		border: 1px solid var(--color-rule-strong);
		border-radius: 6px;
		padding: 8px;
	}
	input {
		width: 100%;
		min-width: 0;
	}
	input::placeholder {
		color: var(--color-ink-3);
	}
	.inspector {
		min-width: 0;
		height: 100%;
		overflow-y: auto;
		scrollbar-gutter: stable;
		scrollbar-color: var(--color-rule-strong) transparent;
		padding: 0 0 24px 24px;
		border-left: 1px solid var(--color-rule);
		overflow-wrap: anywhere;
		scroll-margin-top: 16px;
	}
	.inspector-title {
		position: sticky;
		top: 0;
		z-index: 1;
		padding-bottom: 12px;
		background: var(--color-paper);
	}
	.decision-anchor {
		scroll-margin-top: 80px;
	}
	.purchase {
		margin-top: 12px;
		padding: 12px 0;
		border-top: 1px solid var(--color-rule);
	}
	.candidate-summary {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr);
		align-items: start;
		gap: 8px;
		list-style: none;
	}
	.candidate-summary::-webkit-details-marker {
		display: none;
	}
	:global(.candidate-chevron) {
		margin-top: 8px;
	}
	details[open] > .candidate-summary :global(.candidate-chevron) {
		transform: rotate(90deg);
	}
	.retired {
		color: var(--color-ink-3);
	}
	.btn {
		display: inline-flex;
		justify-content: center;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		border: 1px solid var(--color-rule-strong);
		border-radius: 6px;
		padding: 8px 12px;
		color: var(--color-accent-ink);
		background: var(--color-sheet);
		cursor: pointer;
	}
	.btn:hover {
		background: var(--color-accent-wash);
	}
	.btn-primary {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: var(--color-sheet);
	}
	.btn-primary:hover {
		background: var(--color-accent-ink);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: wait;
	}
	.icon-btn {
		padding: 8px;
		margin: -4px;
		color: var(--color-ink-2);
	}
	a:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	button:focus-visible,
	a:focus-visible,
	input:focus-visible,
	select:focus-visible,
	summary:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 3px;
	}
	@media (max-width: 767px) {
		.canvas-heading {
			gap: 12px;
		}
		.canvas-quote {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 16px;
			width: 100%;
			text-align: left;
		}
		.canvas-quote p {
			font-size: var(--text-heading);
			line-height: var(--text-heading--line-height);
		}
		.canvas-quote a {
			max-width: 160px;
			text-align: right;
		}
		.filter-controls {
			width: 100%;
		}
		.filter-controls > summary {
			display: flex;
			align-items: center;
			gap: 8px;
			min-height: 40px;
			color: var(--color-accent-ink);
			cursor: pointer;
		}
		.filter-options {
			padding-top: 12px;
		}
		.phone-views {
			display: flex;
			gap: 8px;
			margin-bottom: 16px;
		}
		.phone-views button[aria-pressed='true'] {
			border-color: var(--color-accent);
			background: var(--color-accent-wash);
		}
		.canvas-page {
			padding: 16px;
		}
		.workbench {
			display: flex;
			flex-direction: column;
			height: auto;
		}
		.board-area {
			height: auto;
			overflow: visible;
			scrollbar-gutter: auto;
		}
		.inspector-title {
			position: static;
		}
		.workbench > div {
			width: 100%;
		}
		.inspector {
			display: none;
			width: 100%;
			border-left: 0;
			padding: 0;
			height: auto;
			overflow: visible;
			scrollbar-gutter: auto;
		}
		.details-open > .inspector {
			display: block;
		}
		.details-open > .board-area {
			display: none;
		}
		.filter {
			flex: 1 1 140px;
		}
		select {
			max-width: 100%;
			width: 100%;
		}
	}
</style>
