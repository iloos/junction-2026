/**
 * The /request/menu envelope, checked before anything reads it: a JSON object with a known action, and for the steps
 * on a stored menu a menu id (and a revision for edit, accept and plan). Anything else is a 400 with the reason,
 * never a 500 and never a guessed default.
 */
export type MenuAction = 'propose' | 'read' | 'edit' | 'accept' | 'plan';
const ACTIONS: readonly MenuAction[] = ['propose', 'read', 'edit', 'accept', 'plan'];

export function readMenuBody(
	raw: unknown
): { ok: true; body: Record<string, unknown>; action: MenuAction } | { ok: false; reason: string } {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw))
		return { ok: false, reason: 'body must be a JSON object {action, …}' };
	const body = raw as Record<string, unknown>;
	const action = body.action as MenuAction;
	if (!ACTIONS.includes(action))
		return { ok: false, reason: `action must be one of ${ACTIONS.join(', ')}` };
	if (action === 'propose') {
		// An empty request is the domain's refusal (it says what to add), not an envelope error.
		if (body.text !== undefined && typeof body.text !== 'string')
			return { ok: false, reason: 'text must be a string' };
		return { ok: true, body, action };
	}
	if (typeof body.id !== 'string' || !/^[\w:.-]{1,64}$/.test(body.id))
		return { ok: false, reason: 'id is not a menu id' };
	if (action !== 'read' && !(Number.isInteger(body.revision) && (body.revision as number) >= 0))
		return { ok: false, reason: 'revision must be a whole number ≥ 0' };
	return { ok: true, body, action };
}
