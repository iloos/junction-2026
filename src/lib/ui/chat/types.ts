/**
 * One line of a chat turn (`POST /api/chat/turn`, NDJSON) and of `runChatTurn` in-process. Plain data the dock
 * renders; every number comes from the task ledger, every sentence is ours, and nothing here can approve.
 */
import type { ClarifyField, TaskLedger, TaskState } from '$lib/core/contracts/task';
import type { Decision } from '$lib/ui/decisions';
import type { ReceiptView } from '$lib/ui/Receipt.svelte';

export type ChatEvent =
	| {
			type: 'step';
			taskId: string;
			n: number;
			tool: string;
			ok: boolean;
			/** Our one-line summary of the result (ResultMeta), or the refusal. */
			summary: string;
			/** Kitchen deep link to the plan or line the step touched. */
			href?: string;
			/** What a commit did (commit_order steps). */
			receipt?: ReceiptView;
	  }
	| {
			type: 'clarify';
			taskId: string;
			field: ClarifyField;
			question: string;
			options: { label: string; value: string }[];
	  }
	| {
			type: 'decision';
			taskId: string;
			approvalId: string;
			planId: string;
			planVersion: number;
			groups: { reason: string; lineIds: string[]; totalCents: number }[];
			/** The same decisions the Kitchen panel shows (decisionsOf), for the shared DecisionCard. */
			decisions: Decision[];
			/** Product names by id for the cards. */
			names: Record<string, string>;
			/** When the decisions are due (decisionsDue). */
			due: string;
			/** Where a chef approves (Kitchen approval panel). Locates, never authorises. */
			approvalUrl: string;
	  }
	| { type: 'ledger'; taskId: string; ledger: TaskLedger; summary: string }
	| {
			type: 'done';
			taskId: string;
			state: TaskState;
			/** The outcome in our words, backed by the ledger. */
			text: string;
			/** Offered when continuing can do something (approval granted, lines within the mandate). */
			canContinue: boolean;
	  };

export interface ChatTurnInput {
	taskId?: string;
	text?: string;
	answer?: { field: ClarifyField; value: unknown };
	continue?: true;
}
