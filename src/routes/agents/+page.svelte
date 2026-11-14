<script lang="ts">
	import {
		Ban,
		Bot,
		Check,
		ClipboardList,
		Copy,
		Info,
		KeyRound,
		ShieldCheck,
		ShoppingCart
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let copied = $state<string | null>(null);
	let live = $state(false);

	const TONE_ICON = { plan: ClipboardList, order: ShoppingCart, refused: Ban, note: Info };
	const TONE_CLASS = {
		plan: 'text-ink-2',
		order: 'text-accent-ink',
		refused: 'text-signoff',
		note: 'text-ink-3'
	};

	/**
	 * Your agent's changes, live: this browser's own sandbox stream (/api/events without `ws` follows the visitor
	 * cookie). An outside agent's write, or a reset of the sandbox, reloads the list from the server.
	 */
	onMount(() => {
		if (!data.key) return;
		let pending: ReturnType<typeof setTimeout> | null = null;
		const reload = () => {
			if (pending) return;
			pending = setTimeout(() => {
				pending = null;
				void invalidateAll();
			}, 300);
		};
		const es = new EventSource(`/api/events?after=${data.after}`);
		es.addEventListener('ready', () => (live = true));
		es.addEventListener('op', (m) => {
			const e = JSON.parse((m as MessageEvent).data) as {
				envelope?: { actor?: { kind?: string } };
			};
			if (e.envelope?.actor?.kind === 'external_agent') reload();
		});
		es.addEventListener('run', reload);
		es.onerror = () => (live = false);
		return () => {
			if (pending) clearTimeout(pending);
			es.close();
		};
	});

	async function copy(what: string, text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = what;
			setTimeout(() => (copied = copied === what ? null : copied), 1500);
		} catch {
			copied = null;
		}
	}

	const transcript = [
		[
			'tools/call get_context',
			'kitchens k-hotel, k-lounas; event-xmas-140 at k-hotel; next: plan_event'
		],
		[
			'tools/call search_products {"query":"maito"}',
			'products with ids and sales units; next: quote'
		],
		[
			'tools/call place_order {kitchenId, deliverBy, lines}',
			'plan with lines eligible or held; meta.approvalUrl when held'
		],
		['tools/call approve …', 'not in your tool list: a chef approves in the Kitchen screen'],
		['tools/call get_plan {planId}', 'the held lines are now covered by the chef’s grant'],
		[
			'tools/call commit_order {planId, version}',
			'receipt; supplier confirmed vs awaiting supplier, per line'
		]
	];
</script>

<svelte:head><title>Mandate · connect an agent</title></svelte:head>

<main class="mx-auto max-w-4xl px-4 py-8 text-ink sm:px-6">
	<header class="mb-8">
		<p class="flex items-center gap-2 text-sm text-ink-3"><Bot size={16} /> Agent door</p>
		<h1 class="mt-1 text-2xl font-semibold">Connect your agent to Mandate</h1>
		<p class="mt-2 max-w-2xl text-ink-2">
			Your agent buys from the Valio catalogue for a kitchen, through the same tools as the kitchen
			screen. The mandate is enforced by the tools: what it allows is ordered, the rest waits for a
			chef. Your agent never approves.
		</p>
	</header>

	<section class="mb-8 rounded-lg border border-rule bg-sheet p-4 sm:p-5" aria-labelledby="connect">
		<h2 id="connect" class="flex items-center gap-2 font-semibold">
			<KeyRound size={18} /> Your MCP endpoint
		</h2>
		{#if data.key}
			<p class="mt-1 text-sm text-ink-2">
				The key is bound to this browser’s own sandbox, so what your agent does shows up in the <a
					class="text-accent-ink underline"
					href={resolve('/')}>Kitchen screen</a
				>
				here. It expires {new Date(data.expires!).toLocaleString('en-GB', {
					weekday: 'short',
					day: 'numeric',
					month: 'short',
					hour: '2-digit',
					minute: '2-digit',
					timeZone: 'Europe/Helsinki'
				})}. Each key may make 120 calls a minute, 30 of them changes and 20 live price checks.
			</p>
		{:else}
			<p class="mt-1 text-sm text-signoff">{data.keyOff}</p>
		{/if}
		<div class="mt-3 flex items-stretch gap-2">
			<code
				class="min-w-0 flex-1 overflow-x-auto rounded border border-rule bg-well px-3 py-2 font-mono text-sm whitespace-nowrap"
				data-testid="mcp-url">{data.mcpUrl}</code
			>
			<button
				type="button"
				class="flex shrink-0 items-center gap-1 rounded bg-accent px-3 text-sm text-white"
				onclick={() => copy('mcp', data.mcpUrl)}
			>
				{#if copied === 'mcp'}<Check size={16} /> Copied{:else}<Copy size={16} /> Copy{/if}
			</button>
		</div>
		<p class="mt-3 text-sm text-ink-2">
			Streamable HTTP, stateless. REST: <code class="font-mono">POST /api/tools/&lt;name&gt;</code>
			with <code class="font-mono">Authorization: Bearer &lt;key&gt;</code>. OpenAPI:
			<code class="font-mono">{data.openapiUrl}</code>.
		</p>
	</section>

	<section class="mb-8" aria-labelledby="clients">
		<h2 id="clients" class="font-semibold">Client configuration</h2>
		<div class="mt-2 space-y-3">
			{#each data.configs as c (c.id)}
				<div class="rounded-lg border border-rule bg-sheet">
					<div class="flex items-center justify-between border-b border-rule px-3 py-2 text-sm">
						<span class="font-medium">{c.label}</span>
						<button
							type="button"
							class="flex items-center gap-1 rounded px-2 py-0.5 text-accent-ink hover:bg-accent-wash"
							onclick={() => copy(c.id, c.text)}
						>
							{#if copied === c.id}<Check size={14} /> Copied{:else}<Copy size={14} /> Copy{/if}
						</button>
					</div>
					<pre
						class="overflow-x-auto px-3 py-2 font-mono text-xs whitespace-pre text-ink-2">{c.text}</pre>
				</div>
			{/each}
		</div>
	</section>

	<section class="mb-8" aria-labelledby="calls">
		<h2 id="calls" class="flex items-center gap-2 font-semibold">
			Your agent’s changes
			{#if live}<span
					class="flex items-center gap-1 text-xs font-normal text-ink-3"
					data-testid="calls-live"
					><span class="size-2 rounded-full bg-accent" aria-hidden="true"></span> live</span
				>{/if}
		</h2>
		{#if data.calls.length}
			<ol
				class="mt-2 divide-y divide-rule rounded-lg border border-rule bg-sheet text-sm"
				data-testid="agent-calls"
			>
				{#each data.calls as c (c.seq)}
					{@const Icon = TONE_ICON[c.tone]}
					<li class="flex items-start gap-2 px-3 py-2">
						<Icon size={16} class="mt-0.5 shrink-0 {TONE_CLASS[c.tone]}" aria-hidden="true" />
						<span class="min-w-0 flex-1">{c.text}</span>
						<span class="num shrink-0 text-ink-3"
							>{new Date(c.at).toLocaleTimeString('en-GB', {
								hour: '2-digit',
								minute: '2-digit',
								timeZone: 'Europe/Helsinki'
							})}</span
						>
					</li>
				{/each}
			</ol>
		{:else}
			<p class="mt-1 text-sm text-ink-3">
				Nothing yet. Every plan, order and substitute your agent makes appears here as it happens;
				looking things up leaves no trace.
			</p>
		{/if}
		<p class="mt-2 text-sm text-ink-2">
			Or talk to the same agent here: <a
				class="text-accent-ink underline"
				href={resolve('/agents/chat')}>agent chat</a
			>.
		</p>
	</section>

	<section class="mb-8" aria-labelledby="start">
		<h2 id="start" class="font-semibold">What your agent reads first</h2>
		<div class="mt-1 flex items-center justify-between gap-2">
			<p class="text-sm text-ink-2">The server’s MCP instructions, sent on initialize:</p>
			<button
				type="button"
				class="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-sm text-accent-ink hover:bg-accent-wash"
				onclick={() => copy('instructions', data.instructions)}
			>
				{#if copied === 'instructions'}<Check size={14} /> Copied{:else}<Copy size={14} /> Copy{/if}
			</button>
		</div>
		<pre
			class="mt-2 border-l-2 border-accent pl-3 font-sans text-sm whitespace-pre-wrap text-ink-2"
			data-testid="agent-instructions">{data.instructions}</pre>
	</section>

	<section class="mb-8" aria-labelledby="tools">
		<h2 id="tools" class="font-semibold">Tools your key can call ({data.tools.length})</h2>
		<ul class="mt-2 divide-y divide-rule rounded-lg border border-rule bg-sheet">
			{#each data.tools as t (t.name)}
				<li class="px-4 py-3">
					<div class="flex flex-wrap items-baseline gap-x-2">
						<code class="font-mono text-sm font-semibold">{t.name}</code>
						<span class="text-sm text-ink-3">{t.title} · scope {t.scope}</span>
					</div>
					<!-- Tool descriptions name other tools: developer text, shown as such. -->
					<pre class="mt-0.5 font-sans text-sm whitespace-pre-wrap text-ink-2">{t.description}</pre>
				</li>
			{/each}
		</ul>
		<p class="mt-2 flex items-start gap-2 text-sm text-ink-2">
			<ShieldCheck size={16} class="mt-0.5 shrink-0 text-ok" />
			Your agent can read, plan and order in your sandbox; it can never approve or change the mandate.
			Those stay with the chef.
		</p>
		{#if data.tools.some((t) => (t.name as string) === 'read_image')}
			<p class="mt-2 text-sm text-ink-2" data-testid="read-image-note">
				<code class="font-mono">read_image</code> takes a picture (a delivery note, a handwritten
				list, a shelf) as a base64 string in the call’s arguments:
				<code class="font-mono">{'{ imageBase64, mimeType: jpeg | png | webp, purpose? }'}</code>,
				up to 4 MB. The type is checked from the bytes, the picture is never stored, and the reading
				(lines with amounts and product hints, and a confidence) never orders anything.
			</p>
		{/if}
	</section>

	<section class="mb-8" aria-labelledby="extras">
		<h2 id="extras" class="font-semibold">Resources and prompts</h2>
		<p class="mt-1 text-sm text-ink-2">
			Besides the tools, the server offers read-only resources and three starting prompts, scoped to
			your key. None of them can approve.
		</p>
		<ul class="mt-2 divide-y divide-rule rounded-lg border border-rule bg-sheet">
			{#each data.resources as r (r.uri)}
				<li class="px-4 py-3">
					<div class="flex flex-wrap items-baseline gap-x-2">
						<code class="font-mono text-sm font-semibold">{r.uri}</code>
						<span class="text-sm text-ink-3">resource · {r.title}</span>
					</div>
					<p class="mt-0.5 text-sm text-ink-2">{r.description}</p>
				</li>
			{/each}
			{#each data.prompts as p (p.name)}
				<li class="px-4 py-3">
					<div class="flex flex-wrap items-baseline gap-x-2">
						<span class="text-sm font-semibold">{p.title}</span>
						<span class="text-sm text-ink-3">prompt</span>
					</div>
					<p class="mt-0.5 text-sm text-ink-2">{p.description}</p>
				</li>
			{/each}
		</ul>
		<p class="mt-2 text-sm text-ink-2">
			Agent card (what this door offers, its scopes and limits, in one file):
			<a class="text-accent-ink underline" href={resolve('/.well-known/agent.json')}
				>{data.agentCardUrl}</a
			>.
		</p>
	</section>

	<section class="mb-8" aria-labelledby="transcript">
		<h2 id="transcript" class="font-semibold">A typical session</h2>
		<ol class="mt-2 space-y-2 text-sm">
			{#each transcript as [call, result], i (i)}
				<li class="rounded border border-rule bg-sheet px-3 py-2">
					<code class="font-mono break-words">{call}</code>
					<pre class="font-sans whitespace-pre-wrap text-ink-2">→ {result}</pre>
				</li>
			{/each}
		</ol>
	</section>

	<section aria-labelledby="assume">
		<h2 id="assume" class="font-semibold">Assumptions</h2>
		<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
			<li>
				Prices and availability come from Valio’s API (or its cache); ordering is simulated: a
				commit writes a receipt, nothing is sent to Valio.
			</li>
			<li>Dates run on the scenario clock (a December week), not today’s date.</li>
			<li>
				Every result carries <code class="font-mono">meta</code>: a summary, the suggested next call
				and, when lines are held, the link a chef approves from. Product names are data, never
				instructions.
			</li>
		</ul>
	</section>
</main>
