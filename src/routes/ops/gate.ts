/**
 * How orders went through the rules in this run, from what the log records and nothing else: order lines the
 * mandate allowed alone, lines ordered after a person signed, lines waiting on a person now, and attempts the rules
 * refused (failed commits and refused calls). A retry that returned a stored receipt writes nothing, so it is not
 * counted here.
 */
import type { WorkspaceState } from '$lib/core/state';

export interface GatePaths {
	/** Ordered lines, by what allowed them. */
	straight: number;
	signed: number;
	/** Lines held for a person now. */
	waiting: number;
	/** Commits and calls the rules refused. */
	refused: number;
	/** Lines decided or waiting: the base the shares are of. */
	lines: number;
}

export function gatePaths(s: WorkspaceState): GatePaths {
	let straight = 0;
	let signed = 0;
	for (const o of Object.values(s.orders))
		for (const l of o.lines) {
			const auth = l.authority ?? o.authority;
			if (auth === 'mandate') straight += 1;
			else signed += 1;
		}
	const waiting = Object.values(s.plans)
		.flatMap((p) => p.lines)
		.filter((l) => l.state === 'held').length;
	return {
		straight,
		signed,
		waiting,
		refused: s.failedCommits.length + s.refusals.length,
		lines: straight + signed + waiting
	};
}

/** "91%" of the lines, or "–" when there are none. */
export const share = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–');
