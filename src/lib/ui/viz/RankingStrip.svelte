<script lang="ts">
	/**
	 * Explainable ranking strip (LineUp-style): one row per candidate, the bar stacked from each criterion's
	 * weighted contribution (utility × weight) under the rules in force. Changing the rules re-sorts the rows
	 * with a transition; candidates excluded by a hard rule stay visible, greyed, with the rule as a chip.
	 * d3 gets plain rows keyed by product id; the chart has an explicit height.
	 */
	import { select, scaleLinear, easeCubicOut } from 'd3';
	// Registers selection.transition(); the d3 bundle's side effect is tree-shaken out of production builds.
	import 'd3-transition';
	import type { CandidateView } from '$lib/kitchen/view-model';
	import { reasonShort } from '$lib/ui/reasons';

	interface Props {
		candidates: CandidateView[];
		/** Excluded rows shown before folding the rest into "+N more". */
		maxRejected?: number;
	}
	let { candidates, maxRejected = 4 }: Props = $props();

	const ORDER = ['reliability', 'price', 'finnish', 'carbon', 'organic'] as const;
	const LABEL: Record<string, string> = {
		reliability: 'Reliability',
		price: 'Price',
		finnish: 'Finnish',
		carbon: 'Carbon',
		organic: 'Organic'
	};
	const ROW = 46;
	const HEAD = 22;

	interface Seg {
		key: string;
		x0: number;
		x1: number;
		utility: number;
		weight: number;
	}
	interface Row {
		id: string;
		name: string;
		sub: string;
		/** Recipe fit with its source, or "fit not scored". */
		fit: string;
		rank: number | null;
		total: number;
		segs: Seg[];
		chips: string[];
		flags: string[];
		rejected: boolean;
	}

	const exclusion = (code: string) =>
		code === 'UNKNOWN_REQUIRED' || code === 'unknown'
			? 'Qty unknown'
			: code === 'origin_required'
				? 'Not Finnish'
				: code === 'INSUFFICIENT_STOCK'
					? 'Too little stock'
					: reasonShort(code);

	const rows = $derived.by((): { shown: Row[]; hidden: number } => {
		const viable = candidates
			.filter((c) => !c.rejected.length)
			.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
		const rejected = candidates.filter((c) => c.rejected.length);
		// Recipe fit (0–4) for the top candidates: from Gemini when available, else a labelled rule estimate.
		const fitText = (c: CandidateView) => {
			const f = c.score?.fit;
			if (!f) return c.rank && c.rank <= 3 ? 'fit not scored' : '';
			const how =
				f.provenance.source === 'llm'
					? 'Gemini'
					: /rules/.test(`${f.provenance.ref ?? ''} ${f.provenance.note ?? ''}`)
						? 'rule estimate, model unavailable'
						: f.provenance.source.replace('_', ' ');
			return `fit ${f.score}/4 · ${how}`;
		};
		const toRow = (c: CandidateView): Row => {
			let x = 0;
			const segs: Seg[] = [];
			if (!c.rejected.length && c.score)
				for (const k of ORDER) {
					const comp = c.score.components[k];
					if (!comp || comp.weight <= 0) continue;
					const v = comp.utility * comp.weight;
					segs.push({ key: k, x0: x, x1: x + v, utility: comp.utility, weight: comp.weight });
					x += v;
				}
			const flags: string[] = [];
			if (c.chosen) flags.push('In your order');
			if (c.recommended && !c.chosen) flags.push('These rules pick');
			// The server's ranking can still include unknown supply; it never counts as cover.
			const chips = c.rejected.length
				? [...new Set(c.rejected.map(exclusion))]
				: c.kind === 'unknown'
					? ['Qty unknown: not cover']
					: c.partial
						? ['Partial cover']
						: [];
			return {
				id: c.productId,
				name: c.name,
				sub: `${c.productId} · ${c.origin ? c.origin.toUpperCase() : 'origin ?'} · ${c.availableText}`,
				fit: c.rejected.length ? '' : fitText(c),
				rank: c.rank,
				total: c.score?.total ?? 0,
				segs,
				chips,
				flags,
				rejected: c.rejected.length > 0
			};
		};
		return {
			shown: [...viable.map(toRow), ...rejected.slice(0, maxRejected).map(toRow)],
			hidden: Math.max(0, rejected.length - maxRejected)
		};
	});

	let width = $state(0);
	let svg = $state<SVGSVGElement | null>(null);
	const height = $derived(HEAD + rows.shown.length * ROW + 4);

	$effect(() => {
		if (!svg || width < 200) return;
		draw(svg, rows.shown, width);
	});

	function draw(el: SVGSVGElement, data: Row[], w: number) {
		const labelW = Math.min(300, Math.max(170, w * 0.36));
		const tailW = 56;
		const barW = Math.max(80, w - labelW - tailW - 24);
		const maxTotal = Math.max(0.5, ...data.map((d) => d.total));
		const x = scaleLinear().domain([0, maxTotal]).range([0, barW]);
		const root = select(el);

		root
			.selectAll<SVGTextElement, string>('text.head')
			.data(['Candidate', 'Weighted score under your rules'])
			.join('text')
			.attr('class', 'head')
			.attr('x', (_, i) => (i === 0 ? 28 : labelW))
			.attr('y', 14)
			.attr('fill', 'var(--color-ink-3)')
			.attr('font-size', 11.5)
			.text((d) => d);

		const g = root
			.selectAll<SVGGElement, Row>('g.row')
			.data(data, (d) => d.id)
			.join(
				(enter) => {
					const r = enter
						.append('g')
						.attr('class', 'row')
						.attr('transform', (_, i) => `translate(0,${HEAD + i * ROW})`)
						.attr('opacity', 0);
					r.append('rect').attr('class', 'bg').attr('rx', 4);
					r.append('text').attr('class', 'rank');
					r.append('text').attr('class', 'name');
					r.append('text').attr('class', 'sub');
					r.append('rect').attr('class', 'track').attr('rx', 3);
					r.append('g').attr('class', 'segs');
					r.append('text').attr('class', 'total');
					r.append('g').attr('class', 'chips');
					return r;
				},
				(update) => update,
				(exit) => exit.transition().duration(450).ease(easeCubicOut).attr('opacity', 0).remove()
			);

		g.transition()
			.duration(450)
			.ease(easeCubicOut)
			.attr('transform', (_, i) => `translate(0,${HEAD + i * ROW})`)
			.attr('opacity', 1);

		g.select<SVGRectElement>('rect.bg')
			.attr('x', 0)
			.attr('y', 2)
			.attr('width', w)
			.attr('height', ROW - 4)
			.attr('fill', (d) =>
				d.flags.includes('In your order')
					? 'var(--color-accent-wash)'
					: d.flags.length
						? 'var(--color-propose-wash)'
						: 'transparent'
			);
		g.select<SVGTextElement>('text.rank')
			.attr('x', 10)
			.attr('y', 24)
			.attr('font-family', 'var(--font-mono)')
			.attr('font-size', 12.5)
			.attr('fill', (d) => (d.rejected ? 'var(--color-ink-3)' : 'var(--color-ink)'))
			.text((d) => (d.rank ? String(d.rank) : '–'));
		g.select<SVGTextElement>('text.name')
			.attr('x', 28)
			.attr('y', 20)
			.attr('font-size', 13)
			.attr('font-weight', 500)
			.attr('fill', (d) => (d.rejected ? 'var(--color-ink-2)' : 'var(--color-ink)'))
			.text((d) => clip(d.name, labelW - 36, 7.2));
		g.select<SVGTextElement>('text.sub')
			.attr('x', 28)
			.attr('y', 36)
			.attr('font-size', 11)
			.attr('fill', 'var(--color-ink-3)')
			.text((d) => clip(d.sub, labelW - 36, 5.9));
		g.select<SVGRectElement>('rect.track')
			.attr('x', labelW)
			.attr('y', 7)
			.attr('height', 10)
			.attr('width', barW)
			.attr('fill', (d) => (d.rejected ? 'transparent' : 'var(--color-well)'));

		g.select<SVGGElement>('g.segs')
			.attr('transform', `translate(${labelW},7)`)
			.selectAll<SVGRectElement, Seg>('rect')
			.data(
				(d) => d.segs,
				(s) => s.key
			)
			.join((enter) => enter.append('rect').attr('height', 10).attr('width', 0))
			.attr('fill', (s) => `var(--color-c-${s.key})`)
			.each(function (s) {
				select(this)
					.selectAll('title')
					.data([s])
					.join('title')
					.text(
						`${LABEL[s.key]}: utility ${s.utility.toFixed(2)} × weight ${Math.round(s.weight * 100)}% = ${(s.x1 - s.x0).toFixed(2)}`
					);
			})
			.transition()
			.duration(450)
			.ease(easeCubicOut)
			.attr('x', (s) => x(s.x0))
			.attr('width', (s) => Math.max(0, x(s.x1) - x(s.x0)));

		g.select<SVGTextElement>('text.total')
			.attr('y', 16)
			.attr('font-family', 'var(--font-mono)')
			.attr('font-size', 12.5)
			.attr('fill', 'var(--color-ink)')
			.text((d) => (d.rejected ? '' : d.total.toFixed(2)))
			.transition()
			.duration(450)
			.ease(easeCubicOut)
			.attr('x', (d) => labelW + x(d.total) + 6);

		// Chips: exclusions for losers, flags for the order / the recommendation.
		g.select<SVGGElement>('g.chips')
			.attr('transform', (d) => `translate(${labelW},${d.rejected ? 12 : 22})`)
			.each(function (d) {
				const items = [
					...d.flags.map((f) => ({ text: f, kind: f === 'In your order' ? 'order' : 'pick' })),
					...d.chips.map((c) => ({ text: c, kind: d.rejected ? 'out' : 'warn' })),
					...(d.fit ? [{ text: d.fit, kind: 'info' }] : [])
				];
				let cx = 0;
				const placed = items.map((it) => {
					const wch = it.text.length * 6.3 + 14;
					const p = { ...it, x: cx, w: wch };
					cx += wch + 6;
					return p;
				});
				const chip = select(this)
					.selectAll<SVGGElement, (typeof placed)[number]>('g.chip')
					.data(placed, (p) => p.text)
					.join((enter) => {
						const c = enter.append('g').attr('class', 'chip');
						c.append('rect').attr('rx', 9).attr('height', 18);
						c.append('text').attr('y', 12.5).attr('font-size', 11);
						return c;
					})
					.attr('transform', (p) => `translate(${p.x},0)`);
				const STROKE: Record<string, string> = {
					order: 'var(--color-accent)',
					pick: 'var(--color-propose)',
					out: 'var(--color-out)',
					warn: 'var(--color-signoff)',
					info: 'var(--color-ink-2)'
				};
				chip
					.select('rect')
					.attr('width', (p) => p.w)
					.attr('fill', 'var(--color-sheet)')
					.attr('stroke', (p) => STROKE[p.kind])
					.attr('stroke-opacity', 0.55);
				chip
					.select('text')
					.attr('x', 7)
					.attr('fill', (p) => STROKE[p.kind])
					.text((p) => p.text);
			});
	}

	/** Truncate to roughly fit `px` at an average glyph width; the full text is in the row's title. */
	function clip(s: string, px: number, glyph: number) {
		const n = Math.floor(px / glyph);
		return s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s;
	}
</script>

<div bind:clientWidth={width} class="w-full">
	<svg
		bind:this={svg}
		{width}
		{height}
		role="img"
		aria-label="Candidates ranked by weighted score under your rules; excluded candidates listed with their rule"
		class="block"
	></svg>
	{#if rows.hidden}
		<p class="px-7 pb-1 text-meta text-ink-3">
			+{rows.hidden} more excluded by a hard rule (see all candidates)
		</p>
	{/if}
</div>
