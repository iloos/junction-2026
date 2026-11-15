<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * Where each outside service's answers come from right now, from /healthz (external/status.ts): live, stored,
	 * recorded or rules, its breaker and the age of its last live call. Nothing is assumed: a service not called
	 * since the server started says so.
	 */
	type Mode =
		'live' | 'cache' | 'replay' | 'rules' | 'fixture' | 'breaker_open' | 'failing' | 'idle';
	interface Svc {
		service: 'valio' | 'gemini' | 'exa' | 'contextdev';
		mode: Mode;
		configured: boolean;
		breaker: string | null;
		lastLive: { at: string; ok: boolean; ageS: number } | null;
		last: { error?: string } | null;
	}

	const POLL_MS = 15_000;
	const NAME = {
		valio: 'Valio Aimo',
		gemini: 'Gemini',
		exa: 'Exa',
		contextdev: 'Context.dev'
	} as const;

	/** Calls in the last 24 hours from the stored traces (/healthz `day`): survives restarts, counts every process. */
	type Day = Record<string, { calls: number; live: number; liveOk: number; cache: number }>;
	let day = $state.raw<Day>({});
	let services = $state.raw<Svc[]>([]);
	let db = $state<string | null>(null);
	let failed = $state(false);

	async function load() {
		try {
			const r = await fetch('/healthz', { cache: 'no-store' });
			const b = (await r.json()) as { db?: string; services?: Svc[]; day?: Day | null };
			services = b.services ?? [];
			day = b.day ?? {};
			db = b.db ?? null;
			failed = false;
		} catch {
			failed = true;
		}
	}
	onMount(() => {
		void load();
		const t = setInterval(load, POLL_MS);
		return () => clearInterval(t);
	});

	function ago(s: number): string {
		if (s < 60) return `${s} s ago`;
		const m = Math.round(s / 60);
		return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
	}
	/** The one phrase per service, and the tone it reads in. */
	function said(s: Svc): { text: string; tone: 'ok' | 'warn' | 'bad' | 'off' } {
		const d = day[s.service];
		// This process hasn't called it since it started, but the app has today: say what happened, not "not called".
		if (s.mode === 'idle' && d?.calls)
			return {
				text: `${d.calls} call${d.calls === 1 ? '' : 's'} today${d.liveOk ? `, ${d.liveOk} live` : ', from stored answers'}`,
				tone: d.liveOk ? 'ok' : 'warn'
			};
		const live = s.lastLive ? `, last live ${ago(s.lastLive.ageS)}` : '';
		switch (s.mode) {
			case 'live':
				return { text: `live${s.lastLive ? `, ${ago(s.lastLive.ageS)}` : ''}`, tone: 'ok' };
			case 'cache':
				return { text: `stored answers${live}`, tone: 'warn' };
			case 'replay':
				return { text: 'recorded answers', tone: 'warn' };
			case 'rules':
				return { text: 'rules only', tone: 'warn' };
			case 'fixture':
				return { text: 'test data', tone: 'warn' };
			case 'breaker_open':
				return { text: `paused after failures${live}`, tone: 'bad' };
			case 'failing':
				return { text: 'last call failed', tone: 'bad' };
			default:
				if (!s.configured && s.service === 'valio')
					return { text: 'stored offers only', tone: 'warn' };
				return s.configured
					? { text: 'connected, not called yet', tone: 'off' }
					: { text: 'not connected', tone: 'off' };
		}
	}
</script>

<section class="svc" aria-label="Outside services">
	{#if failed}
		<p class="note">Service status unavailable.</p>
	{:else}
		<ul>
			{#each services as s (s.service)}
				{@const w = said(s)}
				<li data-tone={w.tone} title={s.last?.error ?? ''}>
					<i aria-hidden="true"></i><b>{NAME[s.service]}</b>
					<span>{w.text}</span>
				</li>
			{/each}
			{#if db}
				<li data-tone={db === 'ok' ? 'ok' : db === 'error' ? 'bad' : 'off'}>
					<i aria-hidden="true"></i><b>Database</b>
					<span>{db === 'ok' ? 'ok' : db === 'fixture' ? 'in memory (test data)' : db}</span>
				</li>
			{/if}
		</ul>
	{/if}
</section>

<style>
	.svc {
		min-width: 0;
	}
	ul {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 18px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 14px;
		color: var(--muted);
	}
	li {
		--tone: var(--faint);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}
	li[data-tone='ok'] {
		--tone: var(--done);
	}
	li[data-tone='warn'] {
		--tone: var(--sign-off);
	}
	li[data-tone='bad'] {
		--tone: var(--blocked);
	}
	i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--tone);
	}
	li[data-tone='off'] i {
		background: none;
		box-shadow: inset 0 0 0 1.5px var(--faint);
	}
	b {
		font-weight: 500;
		color: var(--text);
	}
	.note {
		margin: 0;
		color: var(--faint);
		font-size: 14px;
	}
</style>
