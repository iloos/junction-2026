/**
 * This browser's remembered request choices, per kitchen: Rank by, the dish way (ready-made or from raw) and the
 * usual delivery weekday. Conveniences only: never the mandate, and every read and write survives blocked storage.
 */
export interface RequestPrefs {
	rankBy?: 'kitchen' | 'price' | 'carbon' | 'finnish' | 'reliability';
	dishOption?: 'ready' | 'raw';
	/** "Thursday". */
	usualDay?: string;
}

const key = (kitchenId: string) => `mandate.request.prefs.${kitchenId}`;
const RANK = new Set(['kitchen', 'price', 'carbon', 'finnish', 'reliability']);
const DAYS = new Set([
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
	'Sunday'
]);

/** Only known values come back; anything else stored is ignored. */
export function readPrefs(raw: unknown): RequestPrefs {
	if (!raw || typeof raw !== 'object') return {};
	const r = raw as Record<string, unknown>;
	return {
		...(typeof r.rankBy === 'string' && RANK.has(r.rankBy)
			? { rankBy: r.rankBy as RequestPrefs['rankBy'] }
			: {}),
		...(r.dishOption === 'ready' || r.dishOption === 'raw' ? { dishOption: r.dishOption } : {}),
		...(typeof r.usualDay === 'string' && DAYS.has(r.usualDay) ? { usualDay: r.usualDay } : {})
	};
}

export function loadPrefs(kitchenId: string): RequestPrefs {
	try {
		return readPrefs(JSON.parse(localStorage.getItem(key(kitchenId)) ?? 'null'));
	} catch {
		return {};
	}
}

export function savePrefs(kitchenId: string, p: RequestPrefs): RequestPrefs {
	const clean = readPrefs(p);
	try {
		localStorage.setItem(key(kitchenId), JSON.stringify(clean));
	} catch {
		// Storage blocked (private window, preview): the choice holds for this page only.
	}
	return clean;
}
