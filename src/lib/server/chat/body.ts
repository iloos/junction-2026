import { ClarifyField, isTaskId } from '$lib/core/contracts/task';
import type { ChatTurnInput } from '$lib/ui/chat/types';

const no = (reason: string) => ({ ok: false as const, reason });

/**
 * The chat turn's request envelope, checked before anything reads it: a JSON object, known fields of the right types,
 * exactly one of text, answer or continue, and any supplied reference valid. A bad task id is refused, never
 * reinterpreted as a fresh task.
 */
export function readTurnBody(
	raw: unknown
): { ok: true; input: ChatTurnInput; kitchenId?: string } | { ok: false; reason: string } {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw))
		return no(
			'body must be a JSON object {taskId?, planId?, kitchenId?, text? | answer? | continue?}'
		);
	const body = raw as Record<string, unknown>;
	const input: ChatTurnInput = {};
	if (body.taskId !== undefined) {
		if (!isTaskId(body.taskId)) return no('taskId is not a task id');
		input.taskId = body.taskId;
	}
	if (body.planId !== undefined) {
		if (typeof body.planId !== 'string' || !/^[\w:.-]{1,128}$/.test(body.planId))
			return no('planId is not a plan id');
		input.planId = body.planId;
	}
	if (
		body.kitchenId !== undefined &&
		(typeof body.kitchenId !== 'string' || !/^k-[a-z0-9-]{1,40}$/.test(body.kitchenId))
	)
		return no('kitchenId is not a kitchen id');
	if (body.text !== undefined) {
		if (typeof body.text !== 'string') return no('text must be a string');
		const text = body.text.trim();
		if (!text || text.length > 500) return no('text: 1–500 characters');
		input.text = text;
	}
	if (body.answer !== undefined) {
		if (!body.answer || typeof body.answer !== 'object' || Array.isArray(body.answer))
			return no('answer must be {field, value}');
		const a = body.answer as { field?: unknown; value?: unknown };
		const field = ClarifyField.safeParse(a.field);
		if (!field.success) return no('answer.field is not a field I ask about');
		input.answer = { field: field.data, value: a.value };
	}
	if (body.continue !== undefined && body.continue !== true) return no('continue must be true');
	if (body.continue === true) input.continue = true;
	if (
		[input.text !== undefined, input.answer !== undefined, input.continue === true].filter(Boolean)
			.length !== 1
	)
		return no('send exactly one of text, answer or continue');
	return {
		ok: true,
		input,
		...(typeof body.kitchenId === 'string' ? { kitchenId: body.kitchenId } : {})
	};
}
