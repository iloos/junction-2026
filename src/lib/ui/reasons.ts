/** Line reasons in plain words, for chips and the Why drawer. Unknown codes fall back to the code itself. */
const TEXT: Record<string, { short: string; long: string }> = {
	out: { short: 'Out of stock', long: 'Out of stock at Valio: 0 available for this delivery.' },
	undeliverable: {
		short: "Can't be delivered",
		long: 'Valio cannot deliver this product to this kitchen on this date. Not a stock problem: it is not on the route.'
	},
	unknown: {
		short: 'Unknown quantity',
		long: 'Terminal item: Valio does not say how many there are. It can be ordered, but it never counts as cover.'
	},
	UNKNOWN_REQUIRED: {
		short: 'Unknown quantity',
		long: 'Terminal item: Valio does not say how many there are. It can be ordered, but it never counts as cover.'
	},
	INSUFFICIENT_STOCK: {
		short: 'Not enough stock',
		long: 'Valio has fewer than this line needs right now; it stays held until it is covered or replaced.'
	},
	NOT_FOUND: { short: 'Unknown product', long: 'This id is not in the Valio catalogue.' },
	TERMS_CHANGED: {
		short: 'Terms changed',
		long: 'Price or availability changed since the quote; the approval no longer applies.'
	},
	blocked: { short: 'Blocked', long: 'Valio has blocked this product.' },
	new_sku: {
		short: 'New product',
		long: 'A product this kitchen has not bought before. Your mandate says to ask first.'
	},
	substitute_breaks_preference: {
		short: 'Breaks a preference',
		long: 'It breaks one of your stated preferences (origin). Needs your sign-off.'
	},
	origin_required: {
		short: 'Origin rule',
		long: 'Your rules require Finnish origin for this category, and this product is not (or its origin is unknown).'
	},
	off_tender_list: {
		short: 'Off tender list',
		long: 'Not on the tender list; anything off the list goes to the named approver.'
	},
	allergen_unknown: {
		short: 'Allergens differ',
		long: 'The allergen set may differ from the planned product. The kitchen never delegates an allergen change.'
	},
	allergen_change: {
		short: 'Allergen change',
		long: 'The allergens change. The kitchen never delegates an allergen change.'
	},
	low_reliability: { short: 'Low reliability', long: "Valio's delivery reliability is low." },
	external_agent_needs_approval: {
		short: 'External agent',
		long: 'Placed by an external agent: always needs a human approval.'
	},
	cutoff_passed: {
		short: 'Cut-off passed',
		long: 'The order cut-off for this delivery has passed.'
	},
	'CAP_EXCEEDED.line': {
		short: 'Over line cap',
		long: 'This line is over the per-line amount the agent may spend alone.'
	},
	'CAP_EXCEEDED.order': {
		short: 'Over order cap',
		long: 'The order total is over the amount the agent may commit alone.'
	},
	'CAP_EXCEEDED.weekly': {
		short: 'Over weekly cap',
		long: "This order would take the week's spend over the weekly cap."
	},
	BELOW_LOT: { short: 'Below lot', long: "Below Valio's minimum lot: cannot be ordered." },
	partial: {
		short: 'Partial cover',
		long: 'Covers only part of the need; the rest is stated as a shortfall.'
	}
};

export function reasonShort(code: string): string {
	return TEXT[code]?.short ?? code;
}

export function reasonLong(code: string): string {
	return TEXT[code]?.long ?? code;
}
