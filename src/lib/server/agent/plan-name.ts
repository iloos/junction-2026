import type { Plan } from '$lib/core/contracts';

/** "Sat 12 Dec": a day in words, never a date code. */
const day = (iso: string) =>
	new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	});

/**
 * A plan named as a chef knows it: the event's title and its day ("Christmas dinner buffet · Sat 12 Dec"), or an
 * order by what it buys ("Order: 4 kg Valio Eila butter · Thu 10 Dec"). Never its id.
 */
export function planName(
	plan: Pick<Plan, 'deliverBy' | 'eventId' | 'needs' | 'lines'>,
	events: readonly { id: string; title: string }[] = []
): string {
	const event = plan.eventId ? events.find((e) => e.id === plan.eventId) : undefined;
	if (event) return `${event.title} · ${day(plan.deliverBy)}`;
	const labels = plan.needs.map((n) => n.label).filter(Boolean);
	const bought = labels.length
		? labels
		: plan.lines
				.filter((l) => l.qty.value > 0)
				.map((l) => `${l.qty.value} ${l.qty.unit} ${l.productName ?? 'product'}`);
	const what = bought.length
		? bought.length <= 2
			? bought.join(', ')
			: `${bought.slice(0, 2).join(', ')} and ${bought.length - 2} more`
		: 'an order';
	return `Order: ${what.slice(0, 60)} · ${day(plan.deliverBy)}`;
}
