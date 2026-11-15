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
			/** What happened, in the chef's words (no ids). */
			summary: string;
			/** Folded detail: which model, how long, a guard that applied. */
			detail?: string;
			/** Server-measured duration of the step. */
			ms?: number;
			/** Where a reading or an answer came from: a live call, an earlier answer or stored data, a recording, the fixture, or the rules. */
			source?: 'live' | 'cache' | 'replay' | 'fixture' | 'rules';
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
			/** `productId` (and `price`, in words) when the chip names a catalogue product: shown with its photo. */
			options: { label: string; value: string; productId?: string; price?: string }[];
	  }
	| {
			/** The chat harness's working memory of the chef's ask (update_draft), shown above the composer. */
			type: 'ask';
			taskId: string;
			ask: AskDraft;
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
	| {
			type: 'ledger';
			taskId: string;
			/** The task's title in plain words, for the dock header. */
			title?: string;
			ledger: TaskLedger;
			summary: string;
	  }
	| {
			/** A menu proposed for an event brief: the chef reviews it on /request, then "plan it" plans it. */
			type: 'menu';
			taskId: string;
			proposalId: string;
			revision: number;
			title: string;
			guests: number;
			date: string;
			dishes: { name: string; course?: string }[];
			/** The brief's food budget, when one was given (the menu aims at it). */
			budgetCents?: number;
			/** Ingredients that have no catalogue product yet: shown as gaps, never guessed. */
			unresolved: number;
			reviewed: boolean;
			reviewUrl: string;
	  }
	| {
			/** What the turn is doing now, in words ("Writing a 3-course menu for 20, about 15 s"); not a message. */
			type: 'status';
			taskId: string;
			text: string;
	  }
	| {
			type: 'done';
			taskId: string;
			/** The task's title for the dock header ("Christmas dinner for 50", "Order for Wed 9 Dec"). */
			title?: string;
			state: TaskState;
			/** The outcome in our words, backed by the ledger. */
			text: string;
			/** Offered when continuing can do something (approval granted, lines within the mandate). */
			canContinue: boolean;
			/** Where a sourced answer came from (a recall notice, a web fact), with the site named. */
			sources?: { url: string; title?: string; host?: string }[];
	  };

export interface ChatTurnInput {
	taskId?: string;
	/**
	 * The plan the screen has open. Without a taskId, the turn joins the task that holds this plan (or starts one on
	 * it, without planning again), so a question is answered about that plan.
	 */
	planId?: string;
	text?: string;
	answer?: { field: ClarifyField; value: unknown };
	continue?: true;
}

/** One part of the ask: a product or ingredient in the chef's words, with what is known about it. */
export interface AskPart {
	words: string;
	amount?: number;
	unit?: string;
	quality?: string;
	productId?: string;
	status?: 'open' | 'asking' | 'fixed' | 'checked' | 'planned' | 'held' | 'ordered';
}

/** What the chef intends, gathered before and while it becomes lines (the harness's update_draft). */
export interface AskDraft {
	occasion?: string;
	date?: string;
	guests?: number;
	splits?: { guests: number; diet: string }[];
	dishes?: {
		name: string;
		course?: string;
		guests?: number;
		diet?: string;
		ingredients?: AskPart[];
	}[];
	items?: AskPart[];
	restrictions?: string[];
	fixed?: string[];
	open?: string[];
	stage?: 'gathering' | 'converting' | 'placed';
}
