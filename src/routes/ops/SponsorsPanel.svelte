<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * The outside calls of the last hour from the stored traces (GET /api/ops/traces/summary): per service, how many
	 * calls, how many the provider itself answered, how many came from stored or recorded answers, and how fast.
	 * A service with no live success says so; stored answers are never counted as the provider answering.
	 */
	interface Summary {
		source: string;
		count: number;
		p50Ms: number | null;
		p95Ms: number | null;
		errorRate: number;
		byMode: { live: number; cache: number; replay: number; fixture: number; none: number };
		liveOk: number;
	}

	let { workspace }: { workspace: string } = $props();

	const POLL_MS = 30_000;
	const NAME: Record<string, string> = {
		valio: 'Valio',
		gemini: 'Gemini',
		exa: 'Exa',
		contextdev: 'Context.dev',
		featherless: 'Featherless',
		nemotron: 'Nemotron',
		tool: 'Our tools'
	};

	let rows = $state.raw<Summary[]>([]);
	let phase = $state<'loading' | 'ok' | 'none' | 'failed'>('loading');

	async function load() {
		try {
			const r = await fetch(
				`/api/ops/traces/summary?ws=${encodeURIComponent(workspace)}&since=1h`,
				{ cache: 'no-store' }
			);
			if (!r.ok) throw new Error(String(r.status));
			const b = (await r.json()) as { sources?: Summary[]; persisted?: boolean };
			rows = (b.sources ?? []).filter((s) => s.byMode);
			phase = b.persisted === false ? 'failed' : rows.length ? 'ok' : 'none';
		} catch {
			phase = 'failed';
		}
	}
	onMount(() => {
		void load();
		const t = setInterval(load, POLL_MS);
		return () => clearInterval(t);
	});

	const ms = (v: number | null) =>
		v == null ? '–' : v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`;
	/** The one sentence per service: who answered. */
	function said(s: Summary): { text: string; tone: 'ok' | 'warn' | 'bad' } {
		const m = s.byMode;
		const stored = m.cache + m.replay;
		const parts: string[] = [];
		if (s.source === 'tool') return { text: `${s.count} tool calls`, tone: 'ok' };
		if (s.liveOk) parts.push(`${s.liveOk} answered live`);
		if (stored) parts.push(`${stored} from stored answers`);
		if (m.fixture) parts.push(`${m.fixture} from test data`);
		const failed = m.live - s.liveOk;
		if (failed) parts.push(`${failed} failed`);
		if (!parts.length) parts.push(`${s.count} calls`);
		return {
			text: parts.join(', '),
			tone: s.liveOk ? (failed ? 'warn' : 'ok') : failed ? 'bad' : 'warn'
		};
	}
</script>

<section class="sponsors" aria-label="Outside calls, last hour">
	<h3>Outside calls, last hour</h3>
	{#if phase === 'loading'}
		<p class="note">Reading the stored calls…</p>
	{:else if phase === 'failed'}
		<p class="note">Stored calls unavailable. The live view below still works.</p>
	{:else if phase === 'none'}
		<p class="note">No outside calls stored in the last hour.</p>
	{:else}
		<ul>
			{#each rows as s (s.source)}
				{@const w = said(s)}
				<li>
					<span class="dot {w.tone}" aria-hidden="true"></span>
					<span class="name">{NAME[s.source] ?? s.source}</span>
					<span class="text">{w.text}</span>
					<span class="num" title="median, 95th percentile">{ms(s.p50Ms)} · {ms(s.p95Ms)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.sponsors {
		margin: 0 0 16px;
	}
	h3 {
		font-size: 0.875rem;
		font-weight: 600;
		margin: 0 0 8px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: grid;
		grid-template-columns: 8px 7.5rem 1fr auto;
		gap: 8px;
		align-items: baseline;
		padding: 4px 0;
		border-bottom: 1px solid var(--line);
		font-size: 0.875rem;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		align-self: center;
	}
	.dot.ok {
		background: var(--done);
	}
	.dot.warn {
		background: var(--sign-off);
	}
	.dot.bad {
		background: var(--blocked);
	}
	.name {
		font-weight: 600;
	}
	.num {
		font-variant-numeric: tabular-nums;
		text-align: right;
		color: var(--muted);
	}
	.note {
		font-size: 0.875rem;
		color: var(--muted);
		margin: 0;
	}
	@media (max-width: 480px) {
		li {
			grid-template-columns: 8px 1fr auto;
		}
		.text {
			grid-column: 2 / -1;
		}
	}
</style>
