/**
 * A tool error in the chef's words. Codes (INVALID_INPUT, STALE_VERSION), tool names and ids belong to the System
 * layer; the sentence says what happened and what still can be done.
 */
export interface ErrorLike {
	code: string;
	message: string;
}

const KNOWN: { test: (e: ErrorLike) => boolean; words: string }[] = [
	{
		test: (e) => /already (committed|ordered)/i.test(e.message) && /substitut/i.test(e.message),
		words: "This dish is already ordered, so its product can't change now."
	},
	{
		test: (e) => /already (committed|ordered)/i.test(e.message),
		words: "That line is already ordered, so it can't change now."
	},
	{
		test: (e) => e.code === 'TERMS_CHANGED' || /TERMS_CHANGED/.test(e.message),
		words: 'The plan changed since you rejected it: decide this line again.'
	},
	{
		test: (e) => e.code === 'STALE_VERSION' || /STALE_VERSION/.test(e.message),
		words: 'The plan changed in the meantime. The page now shows the latest version: try again.'
	},
	{
		test: (e) =>
			e.code === 'APPROVAL_INVALID' || /approval (is )?(void|invalid|expired)/i.test(e.message),
		words: 'That approval no longer applies: the terms changed. Review the new terms first.'
	},
	{
		test: (e) => e.code === 'PROVIDER_UNAVAILABLE',
		words: "Valio's service didn't answer. Nothing was changed: try again in a moment."
	}
];

/** One plain sentence for a tool error; never a code, a tool name or an id. */
export function errorWords(e: ErrorLike): string {
	// A commit that ordered nothing new already says it in the chef's words, with the counts.
	if (e.code === 'DUPLICATE' && /^Already ordered:/.test(e.message)) return e.message;
	const hit = KNOWN.find((k) => k.test(e));
	if (hit) return hit.words;
	const text = e.message
		.replace(/^[a-z][a-z_]*:\s*/, '') // the tool's name
		.replace(/\b[A-Z][A-Z_]{3,}\b:?\s*/g, '') // codes
		.replace(/(?:\s+(?:for|of|on|in|to))?\s*\b(?:pl|ap|ord|rc|ln|ws|run|task)-[\w-]+/g, '') // ids, with the word that pointed at them
		.replace(/\s{2,}/g, ' ')
		.trim();
	if (!text) return 'That did not work. Nothing was changed.';
	const s = text[0].toUpperCase() + text.slice(1);
	return /[.!?]$/.test(s) ? s : `${s}.`;
}
