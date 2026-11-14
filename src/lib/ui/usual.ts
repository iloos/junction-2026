/** What a kitchen's usual order for one day comes to, as UsualOrder reads it, for a headline outside the card. */
export interface UsualSummary {
	/** "Tuesday". */
	weekday: string;
	deliveryDate: string;
	lines: number;
	cents: number;
	/** Lines without a price until planned. */
	unpriced: number;
}

/** The home's first read: "Tuesday's usual is ready: 5 lines, €272. Plan it, or change a line." */
export function usualHeadline(s: UsualSummary, money: (c: number) => string): string {
	const lines = `${s.lines} line${s.lines === 1 ? '' : 's'}`;
	const price = s.cents ? `, ${money(s.cents)}${s.unpriced ? ' so far' : ''}` : '';
	return `${s.weekday}'s usual is ready: ${lines}${price}. Plan it, or change a line.`;
}
