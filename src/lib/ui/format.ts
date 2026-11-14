/** Money and quantity formatting for the kitchen UI. Money is integer cents, EUR ex VAT. */

const eur = new Intl.NumberFormat('en-IE', {
	style: 'currency',
	currency: 'EUR',
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});
const eur0 = new Intl.NumberFormat('en-IE', {
	style: 'currency',
	currency: 'EUR',
	maximumFractionDigits: 0
});

export function money(cents: number | null | undefined, opts: { whole?: boolean } = {}): string {
	if (cents === null || cents === undefined) return '—';
	return (opts.whole ? eur0 : eur).format(cents / 100);
}

/** Signed money delta: "+€934" / "−€12". */
export function moneyDelta(cents: number, opts: { whole?: boolean } = { whole: true }): string {
	const s = money(Math.abs(cents), opts);
	return cents > 0 ? `+${s}` : cents < 0 ? `−${s}` : s;
}

/** A number with up to `max` decimals, trailing zeros dropped. */
export function num(value: number, max = 2): string {
	return new Intl.NumberFormat('en-IE', { maximumFractionDigits: max }).format(value);
}

/** A number with a fixed number of decimals (for kg needs, where 27.0 reads better than 27). */
export function fixed(value: number, digits = 1): string {
	return value.toFixed(digits);
}

export function qty(value: number, unit: string): string {
	return `${num(value)} ${unit}`;
}

const dayFmt = new Intl.DateTimeFormat('en-GB', {
	weekday: 'short',
	day: 'numeric',
	month: 'short'
});

export function day(iso: string): string {
	return dayFmt.format(new Date(`${iso}T12:00:00Z`));
}

export function shortHash(hash: string | null | undefined): string {
	return hash ? hash.slice(0, 8) : '—';
}

const hel = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Helsinki',
	weekday: 'short',
	day: 'numeric',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

/** A scenario instant as Helsinki story time: "Tue 8 Dec, 15:00". */
export function storyTime(at: string | Date): string {
	return hel.format(typeof at === 'string' ? new Date(at) : at);
}

/**
 * Text from the core or a provider with ISO dates in it, as a person reads dates: "2026-11-15T17:00:00+02:00" →
 * "Sun 15 Nov, 17:00", "2026-12-14" → "Mon 14 Dec". Everything else is left as written.
 */
export function humanDates(text: string): string {
	return text.replace(
		/\b(20\d\d-\d\d-\d\d)(T\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?)?/g,
		(_, date: string, time?: string) => (time ? storyTime(`${date}${time}`) : day(date))
	);
}

const KEEP_UPPER = new Set(['MSC', 'ASC', 'UHT', 'HK', 'FI', 'EU', 'XL', 'GN', 'BBQ', 'LTO']);
/**
 * A catalogue name as people read it: the normalised short name when the catalogue has one, else Valio's ALL-CAPS
 * name in sentence case ("AIMO 2,5/1,25KG SINAPPISILLI MSC" → "Aimo 2,5/1,25kg sinappisilli MSC"). Mixed-case
 * names are left as they are.
 */
export function readableName(raw: string, short?: string | null): string {
	if (short) return short;
	const letters = raw.replace(/[^A-Za-zÅÄÖåäö]/g, '');
	const upper = letters.replace(/[^A-ZÅÄÖ]/g, '').length;
	if (letters.length < 4 || upper / letters.length < 0.7) return raw;
	return raw
		.split(/(\s+)/)
		.map((w, i) => {
			if (KEEP_UPPER.has(w)) return w;
			const lower = w.toLocaleLowerCase('fi');
			return i === 0 ? lower.charAt(0).toLocaleUpperCase('fi') + lower.slice(1) : lower;
		})
		.join('');
}
