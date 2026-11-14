<script lang="ts">
	import type { Case, Owner } from './cases';
	import { kitchenHref } from './cases';

	let {
		cases,
		kitchens,
		now,
		relative,
		at
	}: {
		cases: Case[];
		kitchens: { id: string; name: string }[];
		/** "Now" on the same clock as the cases' times (scenario time live, wall time when simulated). */
		now: string;
		/** Show deadlines relative to now (off for the simulated run, whose clock differs). */
		relative: boolean;
		/** Workspace and run the deep links open in the kitchen. */
		at?: { ws: string; run: string | null };
	} = $props();

	let kitchen = $state('all');
	let owner = $state<'all' | Owner>('all');
	let blockedOnly = $state(false);

	const OWNERS: Owner[] = ['Chef', 'Approver', 'Kitchen agent', 'Operations'];
	const kitchenName = (id: string) =>
		kitchens.find((k) => k.id === id)?.name ?? (id || 'All kitchens');

	const shown = $derived(
		cases.filter(
			(c) =>
				(kitchen === 'all' || c.kitchenId === kitchen) &&
				(owner === 'all' || c.owner === owner) &&
				(!blockedOnly || c.tone === 'blocked')
		)
	);
	const counts = $derived(
		Object.fromEntries(OWNERS.map((o) => [o, cases.filter((c) => c.owner === o).length]))
	);

	const fmt = (iso: string) =>
		new Date(iso).toLocaleString('en-GB', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Europe/Helsinki'
		});
	function span(ms: number): string {
		const m = Math.round(Math.abs(ms) / 60_000);
		if (m < 60) return `${m} min`;
		const h = Math.round(m / 60);
		return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
	}
	const due = (iso: string | null) => {
		if (!iso) return { text: 'No deadline', late: false };
		if (!relative) return { text: fmt(iso), late: false };
		const ms = new Date(iso).getTime() - new Date(now).getTime();
		return { text: ms < 0 ? `${span(ms)} late` : `in ${span(ms)}`, late: ms < 0, abs: fmt(iso) };
	};
	const age = (iso: string | null) =>
		iso ? span(Math.max(0, new Date(now).getTime() - new Date(iso).getTime())) : '–';
</script>

<section class="queue" aria-label="Cases to act on">
	<header>
		<h2>
			To act on <span class="n"
				>{shown.length}{shown.length !== cases.length ? ` of ${cases.length}` : ''}</span
			>
		</h2>
		<div class="filters">
			<label>
				<span class="sr">Kitchen</span>
				<select bind:value={kitchen}>
					<option value="all">All kitchens</option>
					{#each kitchens as k (k.id)}<option value={k.id}>{k.name}</option>{/each}
				</select>
			</label>
			<div class="owners" role="group" aria-label="Owner">
				<button aria-pressed={owner === 'all'} onclick={() => (owner = 'all')}>Everyone</button>
				{#each OWNERS as o (o)}
					{#if counts[o]}
						<button aria-pressed={owner === o} onclick={() => (owner = o)}
							>{o} <b>{counts[o]}</b></button
						>
					{/if}
				{/each}
			</div>
			<label class="check"><input type="checkbox" bind:checked={blockedOnly} /> Blocked only</label>
		</div>
	</header>

	{#if shown.length}
		<div class="table" role="table" aria-label="Cases, most urgent first">
			<div class="row head" role="row">
				<span role="columnheader">Due</span>
				<span role="columnheader">What</span>
				<span role="columnheader">Why</span>
				<span role="columnheader">State</span>
				<span role="columnheader">Owner</span>
				<span role="columnheader">Age</span>
				<span role="columnheader">Next step</span>
			</div>
			{#each shown as c (c.id)}
				{@const d = due(c.deadline)}
				{@const href = kitchenHref(c, at)}
				<div class="row" role="row" data-tone={c.tone}>
					<span role="cell" class="due" class:late={d.late} title={d.abs}>{d.text}</span>
					<span role="cell" class="what">
						<b>{c.title}</b>
						<small>{kitchenName(c.kitchenId)}{c.detail ? `, ${c.detail}` : ''}</small>
					</span>
					<span role="cell" class="why">
						{#each c.causes as cause (cause)}<i>{cause}</i>{/each}
					</span>
					<span role="cell" class="state">{c.state}</span>
					<span role="cell" class="owner">{c.owner}</span>
					<span role="cell" class="age">{age(c.since)}</span>
					<span role="cell" class="next">
						{#if href}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- kitchen deep link with query -->
							<a {href}>{c.next}</a>
						{:else}{c.next}{/if}
					</span>
				</div>
			{/each}
		</div>
	{:else if cases.length}
		<p class="none">Nothing matches these filters.</p>
	{:else}
		<p class="none">
			No held lines, refused commits or unresolved anomalies. Check coverage per kitchen on the
			wallboard.
		</p>
	{/if}
</section>

<style>
	.queue {
		background: var(--panel);
		border-radius: 8px;
		padding: 18px 0 8px;
		min-width: 0;
	}
	header {
		padding: 0 20px 12px;
		display: flex;
		flex-wrap: wrap;
		gap: 12px 24px;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		margin: 0;
		font-family: var(--cond);
		font-size: 24px;
		font-weight: 600;
	}
	.n {
		font-family: var(--mono);
		font-size: 18px;
		color: var(--muted);
		font-weight: 400;
		margin-left: 6px;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 14px;
		align-items: center;
		font-size: 16px;
	}
	select {
		background: var(--raise);
		color: var(--text);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 5px 10px;
		font: inherit;
	}
	.owners {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.owners button {
		background: transparent;
		border: 1px solid var(--line);
		color: var(--muted);
		border-radius: 999px;
		padding: 3px 12px;
		font: inherit;
		cursor: pointer;
	}
	.owners button[aria-pressed='true'] {
		background: var(--raise);
		color: var(--text);
		border-color: var(--muted);
	}
	.owners b {
		font-family: var(--mono);
		font-weight: 500;
		margin-left: 4px;
	}
	.check {
		display: inline-flex;
		gap: 6px;
		align-items: center;
		color: var(--muted);
		cursor: pointer;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}

	.table {
		display: flex;
		flex-direction: column;
	}
	.row {
		--tone: var(--act);
		display: grid;
		/* Every column can shrink and wrap, so the table always fits its panel (no clipped last column). */
		grid-template-columns:
			minmax(0, 0.7fr) minmax(0, 1.6fr) minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 0.8fr)
			minmax(0, 0.45fr) minmax(0, 1.1fr);
		gap: 0 14px;
		align-items: baseline;
		padding: 11px 20px 11px 16px;
		border-top: 1px solid var(--line);
		border-left: 4px solid var(--tone);
		font-size: 17px;
	}
	.row[data-tone='propose'] {
		--tone: var(--propose);
	}
	.row[data-tone='sign_off'] {
		--tone: var(--sign-off);
	}
	.row[data-tone='blocked'] {
		--tone: var(--blocked);
	}
	.row.head {
		border-left-color: transparent;
		color: var(--faint);
		font-size: 15px;
		padding-top: 6px;
		padding-bottom: 6px;
	}
	.due {
		font-family: var(--mono);
		font-size: 16px;
	}
	.due.late {
		color: var(--blocked);
	}
	.what b {
		font-weight: 500;
		display: block;
	}
	.what small {
		color: var(--muted);
		font-size: 15px;
	}
	.why {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.why i {
		font-style: normal;
		font-size: 15px;
		padding: 0 8px;
		border: 1px solid var(--line);
		border-radius: 999px;
	}
	.state {
		color: var(--tone);
		font-weight: 500;
	}
	.owner {
		color: var(--text);
	}
	.age {
		font-family: var(--mono);
		color: var(--muted);
		font-size: 16px;
	}
	.next a {
		color: var(--text);
		text-decoration-color: var(--faint);
		text-underline-offset: 3px;
	}
	.next a:hover {
		text-decoration-color: var(--text);
	}
	.none {
		padding: 12px 20px;
		color: var(--muted);
		margin: 0;
	}

	@media (max-width: 1200px) {
		.row {
			grid-template-columns: 1fr 1fr;
			gap: 4px 12px;
		}
		.row.head {
			display: none;
		}
	}
</style>
