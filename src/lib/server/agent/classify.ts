import { classifyRequest, type EventRead } from '$lib/server/request/classify';
import { parseRules, type ParsedItem } from '$lib/server/request/parse';

/**
 * The one reading of what a chef's words ask for, shared by the agent (chat, MCP goal, REST) and /request, so the
 * same words never mean an order on one surface and an event on another. Deterministic and cheap; it runs before
 * any model call. Precedence, first match wins:
 *
 * 1. `authority`: an imperative to approve, or to change a cap, limit, budget or mandate ("approve it", "can you
 *    raise the cap"). Refused: those belong to a chef. A question about them is a read ("what needs my approval?").
 * 2. `read`: a question ("what…", "is…", "show…", "paljonko…"). Never buys, even when it names an amount.
 * 3. `adjust`: grams per guest for a dish ("cured salmon to 160 g per guest").
 * 4. `order` with an amount: a product with a physical amount or a known product word wins over any event word
 *    ("20 kg salmon for the Christmas dinner").
 * 5. `event`: occasion words and no purchase ("Christmas dinner for 50") with the guests and courses stated.
 * 6. `repair`: shortage words.
 * 7. `order` without an amount: an order verb (the caller asks how much).
 * 8. `other`.
 */
export type GoalClass =
	| { kind: 'authority' }
	| { kind: 'read' }
	| { kind: 'adjust' }
	| { kind: 'order'; amount: boolean }
	| { kind: 'event'; event: Omit<EventRead, 'seeded'> }
	| { kind: 'repair' }
	| { kind: 'other' };

const Q_START =
	/^(?:and\s+|so\s+|ok\s+|okay\s+)?(what|what's|whats|which|why|how|when|where|who|whose|is|are|was|were|does|do|did|has|have|show|list|tell me|explain|summari[sz]e|mikä|mitkä|mitä|miksi|miten|milloin|missä|kuka|onko|ovatko|paljonko|kuinka|näytä|kerro|selitä)\b/i;
/** "Can you …", "could you …": a request to act, not a question about state. */
const ASK_TO_ACT =
	/^(?:please\s+|hey\s+|hi\s+|so\s+)?((can|could|would|will|may)\s+(you|u|we|i)\b|voi(t|tko|sitko|tteko|sitteko|sinko|nko)\b)/i;
const APPROVE_IMPERATIVE =
	/\b(approve|hyväksy\p{L}*|grant|sign\s+off(?:\s+on)?)\s+(it|them|this|that|these|those|the|all|everything|every|each|my|our|plan|plans|line|lines|order|orders|held|for\s+me|now|kaikki|ne|se|sen|niitä|nämä|tämä|tämän|tilaus|tilauksen|tilaukset|rivit|rivi|puolestani|nyt)\b/iu;
const APPROVE_BARE = /^(?:please\s+)?(approve|hyväksy\p{L}*)\b/iu;
const CHANGE_AUTHORITY =
	/\b(raise|increase|lift|change|set|remove|bump|double|drop|nosta\p{L}*|muuta\p{L}*|poista\p{L}*|kasvata\p{L}*)\b.{0,40}\b(cap|caps|limit|limits|mandate|budget|ceiling|\p{L}*katto\p{L}*|\p{L}*valtuu\p{L}*|\p{L}*budjet\p{L}*|\p{L}*raja\p{L}*)\b/iu;
const PER_GUEST =
	/(\d+(?:[.,]\d+)?)\s*(g|grams?|kg)\s*(?:per|\/|a|each)\s*(guest|cover|person|head|hlö|henkilö\p{L}*|vieras\p{L}*)/iu;
export const SHORTAGE_WORDS =
	/\b(shortage|shortages|short|out of stock|outage|outages|unavailable|substitut\w*|replace\w*|rescue|repair|loppu\w*|puuttu\w*|korvaa\w*)\b/i;
const ORDER_VERB = /\b(order|reorder|buy|purchase|tilaa|tilaus|osta)\b/i;
/** Units that make an item a purchase line on their own. */
const PHYSICAL = new Set(['l', 'kg', 'pcs', 'case', 'sales']);

/** Whether the words are a question about state rather than an instruction. */
export function isQuestion(text: string): boolean {
	const t = text.trim();
	if (ASK_TO_ACT.test(t)) return false;
	return Q_START.test(t) || (/\?\s*$/.test(t) && !ORDER_VERB.test(t));
}

/** An instruction to approve or to change the delegated authority (never a question about it). */
export function isAuthorityImperative(text: string): boolean {
	const t = text.trim();
	if (isQuestion(t)) return false;
	return APPROVE_IMPERATIVE.test(t) || APPROVE_BARE.test(t) || CHANGE_AUTHORITY.test(t);
}

/** Grams per guest the words set for a dish, with the match, or null. */
export function perGuestIn(text: string): { grams: number; match: RegExpMatchArray } | null {
	const m = text.match(PER_GUEST);
	if (!m) return null;
	return { grams: Number(m[1].replace(',', '.')) * (/^kg/i.test(m[2]) ? 1000 : 1), match: m };
}

/** An item that is a purchase: a known product word, or a quantity in a physical unit. */
export function isPurchaseItem(
	i: Pick<ParsedItem, 'product' | 'qty' | 'unit'> & Partial<Pick<ParsedItem, 'ambiguities'>>
): boolean {
	// "a poem" reads as 1 sales unit by default; only a unit the words state makes a purchase.
	const stated = !i.ambiguities?.some((a) => a.startsWith('no unit given'));
	return (
		i.product !== null || (stated && i.qty !== null && i.unit !== null && PHYSICAL.has(i.unit))
	);
}

/** "4 kg butter": an item with a quantity in a stated unit and something to search for. */
function statesAmount(items: ParsedItem[]): boolean {
	return items.some(
		(i) =>
			i.qty !== null &&
			(i.product !== null || i.search.length > 0) &&
			!i.ambiguities.some((a) => a.startsWith('no unit given'))
	);
}

/**
 * Classifies a chef's words. `text` should already be stripped of anything the surface handles itself (a kitchen
 * id); `today` is the scenario date the parser reads relative dates on.
 */
export function classifyGoal(text: string, today: string): GoalClass {
	const t = text.trim();
	if (isAuthorityImperative(t)) return { kind: 'authority' };
	const items = parseRules(t, today).items;
	// "6 kg butter for Wednesday?" is a request with a question mark; a question word makes it a read.
	if (isQuestion(t) && (Q_START.test(t) || !statesAmount(items))) return { kind: 'read' };
	if (perGuestIn(t)) return { kind: 'adjust' };
	if (statesAmount(items)) return { kind: 'order', amount: true };
	// classifyRequest returns null when an item is a purchase: order wins over the occasion words.
	const ev = classifyRequest(t, items, '');
	if (ev) {
		const { guests, courses, occasion } = ev;
		return { kind: 'event', event: { guests, courses, occasion } };
	}
	if (SHORTAGE_WORDS.test(t)) return { kind: 'repair' };
	if (ORDER_VERB.test(t) || items.some(isPurchaseItem)) return { kind: 'order', amount: false };
	return { kind: 'other' };
}
