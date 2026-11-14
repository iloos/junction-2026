/**
 * Load for the /ops 10× check (CLAUDE.md rule 4): `copies` of the synthetic run interleaved into one run of
 * STRESS_WORKSPACE, every plan, line, approval, order and anomaly id suffixed per copy so they coexist.
 * Dev only: /api/events starts it only when `dev` is true.
 */
import type { ServerEvent } from '$lib/core/contracts';
import { SYNTH_WORKSPACE, syntheticRun } from './synthetic';

import { STRESS_WORKSPACE } from '$lib/server/demo/workspaces';
export { STRESS_WORKSPACE };

const ID =
	/\b((?:p|ap|o|r|an)-(?:hotel|lounas|central|salmon)|(?:h|l|c)-(?:ham|salmon|casserole|herring|milk|cream|potato|eggs|rosolli|carrot|tart|trout))\b/g;

export function stressEvents(copies: number, runId = 'stress-1'): ServerEvent[] {
	const base = JSON.stringify(syntheticRun({ runId, startSeq: 1 }));
	const perCopy = Array.from({ length: copies }, (_, k) =>
		(JSON.parse(base.replace(ID, `$1-${k + 1}`)) as ServerEvent[]).map((e) =>
			JSON.parse(JSON.stringify(e).replaceAll(`"${SYNTH_WORKSPACE}"`, `"${STRESS_WORKSPACE}"`))
		)
	);
	// Interleave step by step across copies, the way many kitchens' agents would act at once.
	const out: ServerEvent[] = [];
	const steps = perCopy[0]?.length ?? 0;
	for (let i = 0; i < steps; i++) for (const c of perCopy) out.push(c[i]);
	return out.map((e, i) => {
		const seq = i + 1;
		if (e.kind === 'op') return { ...e, seq, envelope: { ...e.envelope, seq } };
		if (e.kind === 'sim') return { ...e, seq };
		return e;
	});
}
