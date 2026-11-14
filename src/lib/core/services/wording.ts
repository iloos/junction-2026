/** How each availability kind is said to people. "Out of stock" and "not deliverable" must never read alike (s4). */
import type { AvailabilityKind } from '../contracts';

export const AVAILABILITY_WORDING: Record<AvailabilityKind, string> = {
	known: 'in stock',
	unknown: "Valio doesn't state a quantity",
	out: 'out of stock',
	undeliverable: 'not deliverable',
	blocked: 'not orderable yet (seasonal block)'
};
