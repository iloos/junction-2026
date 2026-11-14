<script lang="ts">
	import { Bot, Check, Copy, KeyRound, ShieldCheck } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let copied = $state<string | null>(null);

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
				The key is bound to this browser’s own sandbox ({data.workspaceId}), so what your agent does
				shows up in the <a class="text-accent-ink underline" href={resolve('/')}>Kitchen screen</a>
				here. It expires {new Date(data.expires!).toLocaleString('en-GB', {
					timeZone: 'Europe/Helsinki'
				})}.
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
		<h2 id="calls" class="font-semibold">Your agent’s changes</h2>
		{#if data.calls.length}
			<ol class="mt-2 divide-y divide-rule rounded-lg border border-rule bg-sheet text-sm">
				{#each data.calls as c (c.seq)}
					<li class="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
						<span class="num text-ink-3">#{c.seq}</span>
						<code class="font-mono font-semibold">{c.type}</code>
						<span class="text-ink-2">{c.via}</span>
						<span class="num ml-auto text-ink-3"
							>{new Date(c.at).toLocaleTimeString('en-GB', { timeZone: 'Europe/Helsinki' })}</span
						>
					</li>
				{/each}
			</ol>
		{:else}
			<p class="mt-1 text-sm text-ink-3">
				Nothing yet. Every plan, order and substitute your key writes shows up here; reads leave no
				trace in the op log.
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
		<p class="mt-1 text-sm text-ink-2">The server’s MCP instructions, sent on initialize:</p>
		<blockquote class="mt-2 border-l-2 border-accent pl-3 text-sm text-ink-2">
			{data.instructions}
		</blockquote>
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
					<p class="mt-0.5 text-sm text-ink-2">{t.description}</p>
				</li>
			{/each}
		</ul>
		<p class="mt-2 flex items-start gap-2 text-sm text-ink-2">
			<ShieldCheck size={16} class="mt-0.5 shrink-0 text-ok" />
			Not in your list: {data.withheld.map((w) => `${w.name} (${w.scope})`).join(', ')}. Those are
			the chef’s.
		</p>
	</section>

	<section class="mb-8" aria-labelledby="transcript">
		<h2 id="transcript" class="font-semibold">A typical session</h2>
		<ol class="mt-2 space-y-2 text-sm">
			{#each transcript as [call, result], i (i)}
				<li class="rounded border border-rule bg-sheet px-3 py-2">
					<code class="font-mono break-words">{call}</code>
					<p class="text-ink-2">→ {result}</p>
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
