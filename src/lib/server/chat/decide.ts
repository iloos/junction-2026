/**
 * D22: the chef typing in their own dock is the chef. "approve all", "accept the salmon", "reject the herring" decide
 * the lines the agent last showed (the task's pending decision, D21), on the version it showed, through the same
 * `approve` tool as the page's Accept / Reject. A sign-off line (an allergen change, never-delegate, the hard limit)
 * is never decided by typed words: it keeps its Confirm-exact-terms card. Changing a cap or the mandate stays refused.
 */
import type { Line, ToolOutput } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { readableName } from '$lib/ui/format';
import { PRODUCTS } from '$lib/server/request/lexicon';

export interface DecisionWords {
	decision: 'grant' | 'deny';
	/** Every shown line, or the lines the words name. */
	all: boolean;
	/** The words naming the lines ("the salmon", "lohi and the milk"). */
	target?: string;
	/** Exactly these lines (a chip that named them, "Order anyway"). */
	lineIds?: string[];
}

const ALL =
	/^(?:all|everything|them all|all of (?:them|it)|it|them|these|those|the lines?|kaikki|ne|se)$/i;
const GRANT =
	/^(?:please\s+|ok,?\s+|yes,?\s+)?(?:approve|accept|grant|hyväksy|hyväksyn)\s+(.+?)\s*[.!]*$/iu;
const DENY = /^(?:please\s+)?(?:reject|deny|decline|refuse|hylkää|keep\s+held)\s+(.+?)\s*[.!]*$/iu;
const BARE = /^(?:please\s+)?(?:approve|accept|hyväksy)\s*[.!]*$/iu;
/** Words about the mandate, a cap or a budget: never a line decision (only a chef changes them, on the page). */
const MANDATE =
	/\b(cap|caps|limit|limits|mandate|budget|ceiling|katto|valtuu\p{L}*|budjet\p{L}*|raja\p{L}*)\b/iu;

/** The decision the chef's words make, or null when they are not one. */
export function decisionWords(text: string): DecisionWords | null {
	const t = text.trim();
	if (MANDATE.test(t)) return null;
	if (BARE.test(t)) return { decision: 'grant', all: true };
	const g = t.match(GRANT);
	const d = g ? null : t.match(DENY);
	const m = g ?? d;
	if (!m) return null;
	const what = m[1].replace(/^the\s+/i, '').trim();
	return {
		decision: g ? 'grant' : 'deny',
		all: ALL.test(what) || /^all\b/i.test(what),
		...(ALL.test(what) ? {} : { target: what })
	};
}

/** Lines the words name: a product word (English or Finnish) or a word of the line's product or ingredient. */
export function namedLines(target: string, lines: Line[], labels: Map<string, string>): Line[] {
	const words = target
		.toLowerCase()
		.split(/\s*(?:,|\band\b|\bja\b)\s*|\s+/)
		.map((w) => w.replace(/^the$/, ''))
		.filter((w) => w.length >= 3);
	// "salmon" also matches "lohi": the lexicon's forms of the same product.
	const forms = new Set(words);
	for (const w of words)
		for (const p of PRODUCTS)
			if (p.forms.includes(w)) [p.search, ...p.forms].forEach((f) => forms.add(f));
	return lines.filter((l) => {
		const hay = `${l.productName ?? ''} ${labels.get(l.id) ?? ''}`.toLowerCase();
		return [...forms].some((f) => hay.includes(f));
	});
}

export interface Decided {
	text: string;
	/** Lines left for a sign-off card (the typed words did not decide them). */
	signOff: number;
	/** Something was decided (the task's decision is now spent). */
	acted: boolean;
}

/**
 * Decides the shown approval's lines as the chef. `shown` is what the last turn showed (approval, plan version,
 * terms); a plan or terms that moved since make it say so instead of deciding on new terms.
 */
export async function decideAsChef(
	words: DecisionWords,
	shown: { approvalId: string; planId: string; planVersion: number; termsHash?: string } | null,
	chef: CallContext,
	handlers: ToolHandlers
): Promise<Decided> {
	if (!shown)
		return {
			text: 'Nothing is waiting for your approval in this conversation. Ask "what needs my decision?" to see it.',
			signOff: 0,
			acted: false
		};
	const r = await handlers.get_plan(chef, { planId: shown.planId });
	if (!r.ok) return { text: "I can't see that plan from here.", signOff: 0, acted: false };
	const { plan, approval } = r.value as ToolOutput<'get_plan'>;
	if (
		plan.version !== shown.planVersion ||
		!approval ||
		approval.id !== shown.approvalId ||
		(shown.termsHash !== undefined && approval.termsHash !== shown.termsHash)
	)
		return {
			text: 'The plan changed since I showed it, so nothing was decided. Here is what waits now.',
			signOff: 0,
			acted: false
		};
	if (approval.state !== 'pending')
		return { text: 'That decision is already made.', signOff: 0, acted: false };
	const pending = plan.lines.filter((l) => approval.lineIds.includes(l.id));
	const labels = new Map(
		pending.map((l) => [l.id, plan.needs.find((n) => n.id === l.needId)?.label ?? ''])
	);
	const chosen = words.lineIds
		? pending.filter((l) => words.lineIds!.includes(l.id))
		: words.all
			? pending
			: namedLines(words.target ?? '', pending, labels);
	if (!chosen.length)
		return {
			text: `None of the lines waiting for you is "${words.target}". Name one of: ${pending
				.slice(0, 4)
				.map((l) => readableName(l.productName ?? l.productId))
				.join(', ')}.`,
			signOff: 0,
			acted: false
		};
	// A sign-off line is never decided by typed words: its card asks for the exact terms.
	const typed = chosen.filter((l) => l.tier !== 'sign_off');
	const signOff = chosen.length - typed.length;
	if (!typed.length)
		return {
			text: `${signOff === 1 ? 'That line needs' : 'Those lines need'} your sign-off on the exact terms: confirm on the card.`,
			signOff,
			acted: false
		};
	const whole = typed.length === pending.length;
	const a = await handlers.approve(chef, {
		approvalId: approval.id,
		planVersion: plan.version,
		termsHash: approval.termsHash,
		decision: words.decision,
		...(whole ? {} : { lineIds: typed.map((l) => l.id) })
	});
	if (!a.ok) return { text: `Not decided: ${a.error.message}`, signOff, acted: false };
	const cents = typed.reduce((t, l) => t + (l.lineCents ?? 0), 0);
	const n = `${typed.length} ${typed.length === 1 ? 'line' : 'lines'}`;
	const head =
		words.decision === 'grant'
			? `Approved ${n} · €${(cents / 100).toFixed(2)}.`
			: `Kept ${n} held: ${typed
					.slice(0, 3)
					.map((l) => readableName(l.productName ?? l.productId))
					.join(', ')}. ${typed.length === 1 ? 'It is' : 'They are'} not ordered.`;
	const tail = signOff
		? ` ${signOff} ${signOff === 1 ? 'needs' : 'need'} your sign-off: confirm on the card.`
		: '';
	return { text: head + tail, signOff, acted: true };
}
