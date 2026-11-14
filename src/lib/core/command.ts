/**
 * D18: one command identity for every entry (Request, Chat, the agent loop, the Kitchen). A commit is identified by
 * the plan, its version, the accepted terms and the exact lines it means to buy. A transport retry of the same command
 * replays its receipt; a newly authorised remainder (other lines, or terms re-approved) is a new command.
 */
import { canonicalJson, sha256Hex } from './hash';

export interface CommandRef {
	planId: string;
	version: number;
	termsHash: string | null;
	/** The exact lines this command buys (order-free). */
	lineIds: readonly string[];
}

/** The idempotency key for a commit_order of exactly these lines on these terms. */
export async function commandKey(c: CommandRef): Promise<string> {
	const digest = await sha256Hex(
		canonicalJson({ terms: c.termsHash, lines: [...c.lineIds].sort() })
	);
	return `cmd-${c.planId}-v${c.version}-${digest.slice(0, 16)}`;
}
