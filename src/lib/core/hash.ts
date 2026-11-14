/** Canonical JSON: sorted object keys, no whitespace, undefined dropped. Terms hashes are computed over this (D6). */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(',')}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The terms an approval binds to: what is bought, how much, at what price, for when. Timestamps are excluded. */
export interface TermsLine {
	productId: string;
	qty: number;
	unit: string;
	unitCents: number;
	/**
	 * Supply evidence other than plain known stock (unknown, unlimited…). Absent for known stock, so terms bound
	 * before this field keep their hash; a line whose supply turns unknown after an approval changes the terms.
	 */
	supply?: string;
	/** Rules a person accepted breaking for this line (requirement_relaxed.*); absent when none. */
	relaxed?: string;
}

export function termsHash(t: { deliverBy: string; lines: TermsLine[] }): Promise<string> {
	const lines = [...t.lines].sort((a, b) =>
		a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0
	);
	return sha256Hex(canonicalJson({ deliverBy: t.deliverBy, lines }));
}

/** Request hash for idempotency: same key + different payload = DUPLICATE. */
export function requestHash(payload: unknown): Promise<string> {
	return sha256Hex(canonicalJson(payload));
}
