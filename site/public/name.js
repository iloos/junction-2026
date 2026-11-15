// A catalogue name as people read it, the same rule as the app's readableName (src/lib/ui/format.ts): Valio's
// ALL-CAPS names in sentence case ("AIMO 2,5/1,25KG SINAPPISILLI MSC" → "Aimo 2,5/1,25kg sinappisilli MSC");
// acronyms and short codes stay as written; mixed-case names are left as they are.
(function () {
	const KEEP_UPPER = new Set(['MSC', 'ASC', 'UHT', 'HK', 'FI', 'EU', 'XL', 'GN', 'BBQ', 'LTO']);
	function readableName(raw) {
		if (typeof raw !== 'string') return raw;
		const letters = raw.replace(/[^A-Za-zÅÄÖåäö]/g, '');
		const upper = letters.replace(/[^A-ZÅÄÖ]/g, '').length;
		if (letters.length < 4 || upper / letters.length < 0.7) return raw;
		let first = true;
		return raw
			.split(/(\s+)/)
			.map((w) => {
				if (KEEP_UPPER.has(w) || /^[A-ZÅÄÖ]{1,2}$/.test(w)) return w;
				const lower = w.toLocaleLowerCase('fi');
				if (first && /^[A-ZÅÄÖ]{3,}/.test(w)) {
					first = false;
					return lower.charAt(0).toLocaleUpperCase('fi') + lower.slice(1);
				}
				return /[A-ZÅÄÖ]/.test(w) ? lower : w;
			})
			.join('');
	}
	/** Every product name a recorded text mentions, made readable in place (names come from the same recording). */
	function readableIn(text, names) {
		let out = text;
		for (const n of names || []) if (n && out.includes(n)) out = out.split(n).join(readableName(n));
		return out;
	}
	window.readableName = readableName;
	window.readableIn = readableIn;
})();
