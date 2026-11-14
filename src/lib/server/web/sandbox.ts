/**
 * Recalls for a visitor's sandbox, run when the sandbox is seeded (no network):
 * 1. every recent public notice already read is applied to the visitor's run (`applyKnown`), so a judge's
 *    own workspace shows the real recalls the monitor found, not only the demo workspace;
 * 2. with `drillProductId`, the recorded real notice is re-targeted at that product and filed as a DRILL in
 *    the visitor's own `drill:<ws>:…` namespace, so a held line can be shown, labelled as a drill.
 */
import type { CallContext } from '$lib/core/ports';
import { applicationsFor, findingsFor, scopeOf, webContext } from '.';
import { applyKnown, busTrace, replayRecorded } from './watch';
import type { IngestDeps, IngestResult } from './ingest';

type Env = Record<string, string | undefined>;

export interface SandboxRecalls {
	workspaceId: string;
	applied: IngestResult[];
	drill: IngestResult | null;
	note: string;
}

/** Stored notices applied to `deps.scope`, plus a labelled drill when `drillGtin` is given. No network. */
export async function sandboxRecalls(
	deps: IngestDeps,
	o: { drillGtin?: string } = {}
): Promise<Omit<SandboxRecalls, 'workspaceId'>> {
	const applied = await applyKnown(deps);
	const drill = o.drillGtin ? await replayRecorded(deps, { drillGtin: o.drillGtin }) : null;
	return {
		applied,
		drill,
		note: `${applied.length} stored public notice(s) applied${drill ? '; one labelled DRILL re-targeted at a plan product' : ''}. No network call.`
	};
}

/** Called by the sandbox seeder for a visitor's new workspace and run. */
export async function prepareSandboxRecalls(
	env: Env,
	ctx: CallContext,
	o: { drillProductId?: string } = {}
): Promise<SandboxRecalls> {
	const w = await webContext(ctx);
	const drillGtin = o.drillProductId
		? (await w.ports.catalog.get([o.drillProductId])).get(o.drillProductId)?.gtin
		: undefined;
	const r = await sandboxRecalls(
		{
			store: w.ports.store,
			index: w.index,
			scope: scopeOf(w),
			findings: findingsFor(env),
			applications: applicationsFor(env),
			actor: ctx.actor
		},
		{ drillGtin }
	);
	busTrace(scopeOf(w), { lane: 'web' })('step', {
		source: 'context.dev',
		model: 'stored',
		purpose: 'sandbox recalls',
		applied: r.applied.length,
		drill: !!r.drill
	});
	return { workspaceId: ctx.workspaceId, ...r };
}
