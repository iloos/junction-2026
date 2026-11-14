<script lang="ts">
	/**
	 * Cut-off timeline: the scenario week from "now" to the event, with the order cut-off, delivery and the buffet
	 * as pins. Open lines run as lanes from now to the cut-off they must beat: Stock lines (known quantity) and
	 * Terminal lines (supplier-delivered, quantity unknown). The scenario has one enforced cut-off; Terminal
	 * supplier lead times are not modelled, and the lane says so instead of inventing one. "Now" ticks.
	 */
	import { select, scaleTime, axisBottom, timeDay, timeFormat } from 'd3';
	import { SCENARIO } from '$lib/core/scenario';

	interface Lane {
		id: 'stock' | 'terminal';
		label: string;
		count: number;
		note: string;
	}
	interface Props {
		now: Date | null;
		/** Open (not yet committed) lines by supply kind. */
		stock: number;
		terminal: number;
		committed: boolean;
	}
	let { now, stock, terminal, committed }: Props = $props();

	const HEIGHT = 168;
	const M = { top: 30, right: 16, bottom: 26, left: 128 };
	const LANE = 34;

	const cutoff = new Date(SCENARIO.cutoff);
	const delivery = new Date(`${SCENARIO.delivery}T08:00:00+02:00`);
	const event = new Date(`${SCENARIO.event}T18:00:00+02:00`);
	const start = new Date(new Date(SCENARIO.start).getTime() - 3 * 3600_000);
	const end = new Date(`${SCENARIO.event}T23:59:00+02:00`);

	const lanes = $derived<Lane[]>([
		{
			id: 'stock',
			label: 'Stock lines',
			count: stock,
			note: 'known quantity · must beat the cut-off'
		},
		{
			id: 'terminal',
			label: 'Terminal lines',
			count: terminal,
			note: 'supplier lead time not modelled: same cut-off applied'
		}
	]);

	let width = $state(0);
	let svg = $state<SVGSVGElement | null>(null);

	const left = $derived.by(() => {
		if (!now) return '';
		const ms = cutoff.getTime() - now.getTime();
		if (ms <= 0) return 'cut-off passed';
		const h = Math.floor(ms / 3600_000);
		const m = Math.floor((ms % 3600_000) / 60_000);
		return `${h} h ${String(m).padStart(2, '0')} min to cut-off`;
	});

	$effect(() => {
		if (!svg || width < 280) return;
		draw(svg, width, now, lanes, committed);
	});

	function draw(el: SVGSVGElement, w: number, t: Date | null, data: Lane[], done: boolean) {
		// On a phone the lane names sit above their bars and the notes drop: the axis gets the full width.
		const narrow = w < 560;
		const ml = narrow ? 8 : M.left;
		const x = scaleTime()
			.domain([start, end])
			.range([ml, w - M.right]);
		const root = select(el);
		const fmt = timeFormat(narrow ? '%a' : '%a %-d');

		root
			.selectAll<SVGGElement, null>('g.axis')
			.data([null])
			.join('g')
			.attr('class', 'axis')
			.attr('transform', `translate(0,${HEIGHT - M.bottom})`)
			.call(
				axisBottom(x)
					.ticks(timeDay.every(1))
					.tickFormat((d) => fmt(d as Date))
					.tickSizeOuter(0)
			)
			.call((g) => g.selectAll('text').attr('fill', 'var(--color-ink-3)').attr('font-size', 11))
			.call((g) => g.selectAll('line,path').attr('stroke', 'var(--color-rule-strong)'));

		const pins = [
			{ id: 'cutoff', at: cutoff, label: 'Order cut-off', color: 'var(--color-signoff)' },
			{ id: 'delivery', at: delivery, label: 'Delivery', color: 'var(--color-accent)' },
			{ id: 'event', at: event, label: 'Buffet, 140', color: 'var(--color-ink)' }
		];
		const pin = root
			.selectAll<SVGGElement, (typeof pins)[number]>('g.pin')
			.data(pins, (d) => d.id)
			.join((enter) => {
				const g = enter.append('g').attr('class', 'pin');
				g.append('line');
				g.append('text');
				return g;
			})
			.attr('transform', (d) => `translate(${x(d.at)},0)`);
		pin
			.select('line')
			.attr('y1', 18)
			.attr('y2', HEIGHT - M.bottom)
			.attr('stroke', (d) => d.color)
			.attr('stroke-width', 1.5)
			.attr('stroke-dasharray', (d) => (d.id === 'cutoff' ? null : '3 3'));
		pin
			.select('text')
			.attr('y', 13)
			.attr('text-anchor', (d) =>
				d.id === 'event' ? 'end' : d.id === 'cutoff' ? (narrow ? 'start' : 'middle') : 'middle'
			)
			.attr('x', (d) => (d.id === 'cutoff' && narrow ? 4 : 0))
			.attr('font-size', 11.5)
			.attr('font-weight', 500)
			.attr('fill', (d) => d.color)
			.text((d) => (narrow && d.id === 'cutoff' ? 'Cut-off' : d.label));

		const lane = root
			.selectAll<SVGGElement, Lane>('g.lane')
			.data(data, (d) => d.id)
			.join((enter) => {
				const g = enter.append('g').attr('class', 'lane');
				g.append('text').attr('class', 'name');
				g.append('text').attr('class', 'note');
				g.append('rect').attr('class', 'bar').attr('rx', 3);
				return g;
			})
			.attr('transform', (_, i) => `translate(0,${M.top + 6 + i * LANE})`);
		lane
			.select('text.name')
			.attr('x', narrow ? ml : 0)
			.attr('y', narrow ? 2 : 12)
			.attr('font-size', narrow ? 11.5 : 12.5)
			.attr('font-weight', 500)
			.attr('fill', 'var(--color-ink)')
			.text((d) => `${d.label} · ${d.count}`);
		lane
			.select('text.note')
			.attr('x', x(cutoff) + 8)
			.attr('y', 13)
			.attr('font-size', 11)
			.attr('fill', 'var(--color-ink-3)')
			.text((d) => (narrow ? '' : d.count ? d.note : 'none open'));
		lane
			.select('rect.bar')
			.attr('x', t ? x(t) : ml)
			.attr('y', narrow ? 7 : 4)
			.attr('height', 12)
			.attr('width', (d) => (t && d.count && !done ? Math.max(0, x(cutoff) - x(t)) : 0))
			.attr('fill', (d) => (d.id === 'stock' ? 'var(--color-accent)' : 'var(--color-well)'))
			.attr('fill-opacity', (d) => (d.id === 'stock' ? 0.75 : 1))
			.attr('stroke', (d) => (d.id === 'terminal' ? 'var(--color-ink-3)' : 'none'))
			.attr('stroke-dasharray', '4 3');

		const nowG = root
			.selectAll<SVGGElement, Date>('g.now')
			.data(t ? [t] : [])
			.join((enter) => {
				const g = enter.append('g').attr('class', 'now');
				g.append('line');
				g.append('text');
				return g;
			})
			.attr('transform', (d) => `translate(${x(d)},0)`);
		nowG
			.select('line')
			.attr('y1', 18)
			.attr('y2', HEIGHT - M.bottom)
			.attr('stroke', 'var(--color-out)')
			.attr('stroke-width', 2);
		nowG
			.select('text')
			.attr('y', 13)
			.attr('text-anchor', 'start')
			.attr('x', 4)
			.attr('font-size', 11.5)
			.attr('font-weight', 600)
			.attr('fill', 'var(--color-out)')
			.text(narrow ? '' : 'Now');
	}
</script>

<section aria-labelledby="timeline-h" class="rounded-lg border border-rule bg-sheet px-4 pt-3 pb-1">
	<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<h2 id="timeline-h" class="text-body font-semibold text-ink">By when</h2>
		<p class="text-meta text-ink-2">
			{#if committed}Ordered: nothing waits on the cut-off.{:else}<span class="mono text-ink"
					>{left}</span
				> · scenario clock{/if}
		</p>
	</div>
	<div bind:clientWidth={width} class="mt-1 w-full">
		<svg
			bind:this={svg}
			{width}
			height={HEIGHT}
			role="img"
			aria-label="Scenario timeline: now, order cut-off {cutoff.toISOString()}, delivery {SCENARIO.delivery}, buffet {SCENARIO.event}; {stock} Stock and {terminal} Terminal lines open"
			class="block"
		></svg>
	</div>
</section>
