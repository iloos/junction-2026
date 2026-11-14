/**
 * The `read_image` tool (read scope): a picture in, its reading out, on every surface (REST, MCP, the agent). The
 * reading is evidence: nothing is ordered and the picture is not kept.
 */
import { err, ok, toolSchemas, type Result, type ToolOutput } from '$lib/core/contracts';
import type { CallContext, Llm } from '$lib/core/ports';
import { readImage } from './read';

export function readImageHandler(d: { llm: () => Llm | null }) {
	return async (ctx: CallContext, raw: unknown): Promise<Result<ToolOutput<'read_image'>>> => {
		if (!ctx.scopes.includes('read')) return err('FORBIDDEN', 'read_image needs the read scope');
		const p = toolSchemas.read_image.input.safeParse(raw);
		if (!p.success)
			return err(
				'INVALID_INPUT',
				p.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
			);
		const r = await readImage(p.data, { llm: d.llm() });
		if (!r.ok) return r;
		const { reading, source, model, latencyMs } = r.value;
		return ok({
			reading,
			meta: {
				summary:
					`[${source}] Read a ${reading.kind.replace('_', ' ')}: ${reading.lines.length} line(s), confidence ${reading.confidence.toFixed(2)} (${model}, ${latencyMs} ms). What the picture says, not a catalogue match; nothing was ordered and the picture was not stored.`.slice(
						0,
						400
					)
			}
		});
	};
}
