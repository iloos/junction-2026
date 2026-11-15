/**
 * A half-formed ask is never rejected (user steer, ring 6): "1000 x", "200", "for friday", "same as last week" are read
 * as far as they go, and the likeliest completions come back as chips, the words kept, so one tap continues. A chip's
 * value is `say:<words>`: the dock sends it as the chef's next message.
 */
import { findDate } from '$lib/server/request/dates';

export interface HalfAsk {
	question: string;
	options: { label: string; value: string }[];
}

const say = (words: string) => ({ label: words, value: `say:${words}` });
const num = (n: number) => n.toLocaleString('en-GB');
/** "Fri 11 Dec" */
const dayLabel = (iso: string) =>
	new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	});

/** The reading and its chips, or null when the words are not a half-formed ask this knows. */
export function halfAsk(text: string, today: string, context?: { menu?: string }): HalfAsk | null {
	const t = text.trim().replace(/\s+/g, ' ');
	// "1000 x", "200", "1,000 kpl": a number with nothing to count.
	const n = t.match(/^(\d{1,3}(?:[ ,]\d{3})+|\d{1,6})\s*(?:x|×|pcs|kpl|pieces|of)?\s*[?.!]*$/i);
	if (n) {
		const v = Number(n[1].replace(/[ ,]/g, ''));
		if (!v) return null;
		return {
			question: `Got it, ${num(v)}. Of what?`,
			options: [
				...(context?.menu ? [say(`${v} guests for ${context.menu}`)] : []),
				say(`a menu for ${v} guests`),
				say(`${v} l milk`),
				say(`${v} kg potatoes`)
			].slice(0, 4)
		};
	}
	// "for friday", "on Monday": a day with nothing to deliver.
	const day = t.match(/^(?:for|on|by|ensi)?\s*(.+?)\s*[?.!]*$/i);
	const d = day ? findDate(day[1], today) : null;
	if (d && !d.invalid && d.text.length >= day![1].length - 2) {
		const when = dayLabel(d.iso);
		return {
			question: `Got it, ${when}. What should arrive then?`,
			options: [
				say(`20 l milk for ${when}`),
				say(`10 kg butter for ${when}`),
				say(`what is planned for ${when}?`)
			]
		};
	}
	// "same as last week", "the usual": the kitchen's usual order.
	if (
		/\b(same as (?:last|previous) (?:week|time|order)|the usual|as usual|repeat (?:last|the) order|sama kuin viime)/i.test(
			t
		)
	)
		return {
			question: 'The usual order, then. Which day should it arrive?',
			options: [
				say('the usual order for Friday'),
				say('the usual order for Monday'),
				say('what did we order last week?')
			]
		};
	return null;
}

/** Chips for "How much milk?": the product kept, three amounts in its likely unit. */
export function amountChips(product: string, unit: 'l' | 'kg' | 'pcs' | null): HalfAsk['options'] {
	const u = unit ?? 'kg';
	const steps = u === 'pcs' ? [10, 30, 60] : [5, 10, 20];
	return steps.map((s) => say(`${s} ${u} ${product}`));
}
