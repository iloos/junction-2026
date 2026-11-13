import { z } from 'zod';
import { OpEnvelope } from './ops';
import { IsoDateTime, ProductId, Scope } from './primitives';

/** Simulator events (docs/research/supply-chain.md). Ring 0 emits the first three; the rest are Ring 1. */
export const SimEventKind = z.enum([
	'atp.changed',
	'contention.detected',
	'cutoff.closed',
	'allocation.decided',
	'supply.arrived'
]);
export type SimEventKind = z.infer<typeof SimEventKind>;

export const SimEvent = z.object({
	kind: SimEventKind,
	productId: ProductId.optional(),
	/** Simulator clock time, not wall time. */
	simAt: IsoDateTime,
	detail: z.record(z.string(), z.unknown()),
	/** Always labelled simulated in the UI. */
	label: z.string()
});
export type SimEvent = z.infer<typeof SimEvent>;

/**
 * What SSE and `Ops.readAfter` deliver. Clients subscribe first, then catch up from their last seq,
 * deduplicate by seq, and poll on reconnect (D6).
 */
export const ServerEvent = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('op'), seq: z.int().positive(), envelope: OpEnvelope }),
	z.object({ kind: z.literal('sim'), seq: z.int().positive(), ...Scope.shape, event: SimEvent }),
	/** Agent trace steps (model, tokens, latency, tool calls): CLAUDE.md rule 7. Not part of state. */
	z.object({
		kind: z.literal('trace'),
		...Scope.shape,
		at: IsoDateTime,
		step: z.enum(['step', 'text', 'tool', 'decision', 'done', 'error']),
		data: z.record(z.string(), z.unknown())
	})
]);
export type ServerEvent = z.infer<typeof ServerEvent>;
