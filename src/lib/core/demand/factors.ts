import { z } from 'zod';
import { IsoDate } from '../contracts/primitives';

const Weekday = z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
type Weekday = z.infer<typeof Weekday>;

export const CalendarFactor = z.looseObject({
	id: z.string(),
	name: z.string(),
	/** Matches a key of the kitchen's factorSensitivity (event, month, holiday, …). */
	kind: z.string(),
	from: IsoDate,
	to: IsoDate,
	/** The window the factor affects covers, when it differs from the event's own dates. */
	applyFrom: IsoDate.optional(),
	applyTo: IsoDate.optional(),
	weekdays: z.array(Weekday).optional(),
	value: z.number().nonnegative(),
	valueKind: z.string(),
	appliesTo: z.array(z.string()),
	source: z.looseObject({ name: z.string(), url: z.string().optional() })
});
export type CalendarFactor = z.infer<typeof CalendarFactor>;

export interface AppliedFactor {
	id: string;
	name: string;
	/** The factor's own value from the calendar. */
	value: number;
	/** After the kitchen's sensitivity: 1 + (value − 1) × sensitivity, or 0 for a closure. */
	adjusted: number;
	valueKind: string;
	source: CalendarFactor['source'];
}

export const FACTOR_CLAMP: readonly [number, number] = [0.5, 2];

/** Weekday of a 'YYYY-MM-DD' date, computed in UTC so the local timezone cannot shift it. */
export function weekdayOf(date: string): Weekday {
	const [y, m, d] = date.split('-').map(Number);
	return Weekday.options[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * Multiplier for one covers key on one date. Each applicable factor contributes
 * 1 + (v − 1) × sensitivity and the product is clamped to [0.5, 2]. A closure (value 0) with
 * sensitivity > 0 is a mask: demand is 0, not clamped up to 0.5. Sensitivity defaults to 0, so a
 * kitchen that does not list a kind ignores it.
 */
export function factorFor(
	date: string,
	appliesTo: string,
	factors: readonly CalendarFactor[],
	sensitivity: Readonly<Record<string, number>>,
	clamp: readonly [number, number] = FACTOR_CLAMP
): { value: number; applied: AppliedFactor[] } {
	const applied: AppliedFactor[] = [];
	const weekday = weekdayOf(date);
	let product = 1;
	let masked = false;

	for (const f of factors) {
		const from = f.applyFrom ?? f.from;
		const to = f.applyTo ?? f.to;
		// ISO dates order correctly as strings.
		if (date < from || date > to) continue;
		if (!f.appliesTo.includes(appliesTo)) continue;
		if (f.weekdays && !f.weekdays.includes(weekday)) continue;
		const s = sensitivity[f.kind] ?? 0;
		if (s <= 0) continue;
		const closure = f.value === 0;
		const adjusted = closure ? 0 : 1 + (f.value - 1) * s;
		if (closure) masked = true;
		else product *= adjusted;
		applied.push({
			id: f.id,
			name: f.name,
			value: f.value,
			adjusted,
			valueKind: f.valueKind,
			source: f.source
		});
	}

	const value = masked ? 0 : Math.min(clamp[1], Math.max(clamp[0], product));
	return { value: Math.round(value * 1e9) / 1e9, applied };
}
