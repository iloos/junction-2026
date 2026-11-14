/**
 * What may leave the process in a log line or a stored trace: no keys, tokens, cookies or connection strings,
 * and no prompts or request bodies. Keys that name a secret are blanked, prompt-like keys are dropped, and string
 * values are scrubbed of credential shapes and cut short. Plain functions, no I/O.
 */

/** Keys whose value is a credential. `tokensIn` and `maxTokens` are counts and stay. */
const SECRET_KEY =
	/^(key|token|secret|password|passwd|pwd|authorization|auth|cookie|cookies|set-cookie|bearer|credentials?|dsn|connection(string)?|database_?url)$|api[-_]?key|secret|password|access[-_]?token|refresh[-_]?token|id[-_]?token|private[-_]?key|client[-_]?secret/i;

/** Keys that carry model input or a request body: never logged or stored. */
const BODY_KEY =
	/^(prompt|prompts|system|systemprompt|messages|contents|body|rawinput|input|image|imagebase64|data_?url)$/i;

const SECRET_VALUE: [RegExp, string][] = [
	[/Bearer\s+[\w.~+/=-]+/gi, 'Bearer [redacted]'],
	[/\bAIza[\w-]{20,}/g, '[redacted]'],
	[/\bsk-[\w-]{16,}/g, '[redacted]'],
	[/\b(gh[pousr]_[A-Za-z0-9]{20,})/g, '[redacted]'],
	[/\b(postgres(?:ql)?|mysql|redis|amqps?):\/\/[^\s"']+/gi, '$1://[redacted]'],
	[/([?&](?:key|api_key|apikey|token|access_token|sig|signature)=)[^&\s"']+/gi, '$1[redacted]'],
	[/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '[redacted]']
];

export const MAX_STRING = 500;

export function scrubString(s: string, max = MAX_STRING): string {
	let out = s;
	for (const [re, sub] of SECRET_VALUE) out = out.replace(re, sub);
	return out.length > max ? `${out.slice(0, max)}…` : out;
}

export function isSecretKey(k: string): boolean {
	return SECRET_KEY.test(k);
}

/** A redacted copy: secrets blanked, bodies dropped, strings scrubbed, depth and array length bounded. */
export function redact(value: unknown, o: { maxString?: number; maxArray?: number } = {}): unknown {
	const maxString = o.maxString ?? MAX_STRING;
	const maxArray = o.maxArray ?? 20;
	const walk = (v: unknown, depth: number): unknown => {
		if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
		if (typeof v === 'string') return scrubString(v, maxString);
		if (typeof v === 'bigint') return Number(v);
		if (v instanceof Date) return v.toISOString();
		if (v instanceof Error) return scrubString(v.message, maxString);
		if (typeof v !== 'object') return undefined;
		if (depth >= 4) return '[nested]';
		if (Array.isArray(v)) {
			const head = v.slice(0, maxArray).map((x) => walk(x, depth + 1));
			return v.length > maxArray ? [...head, `…${v.length - maxArray} more`] : head;
		}
		const out: Record<string, unknown> = {};
		for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
			if (BODY_KEY.test(k)) continue;
			if (isSecretKey(k)) {
				out[k] = '[redacted]';
				continue;
			}
			const w = walk(x, depth + 1);
			if (w !== undefined) out[k] = w;
		}
		return out;
	};
	return walk(value, 0);
}

/**
 * A redacted object whose JSON is at most `maxBytes`: first as is, then with short strings and arrays, else only
 * its key names. Stored traces use 4 KB.
 */
export function capJson(data: Record<string, unknown>, maxBytes = 4096): Record<string, unknown> {
	const full = redact(data) as Record<string, unknown>;
	if (JSON.stringify(full).length <= maxBytes) return full;
	const small = redact(data, { maxString: 120, maxArray: 5 }) as Record<string, unknown>;
	if (JSON.stringify(small).length <= maxBytes) return { ...small, truncated: true };
	return { truncated: true, keys: Object.keys(full).slice(0, 40) };
}
