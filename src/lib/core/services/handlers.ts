/**
 * One handler per tool (the ToolHandlers seam in core/ports.ts). Every handler: check the caller's scope,
 * validate the input with the tool's zod schema, then run the service. Pure except through `Ports`.
 */
import {
	err,
	toolSchemas,
	type DomainError,
	type Result,
	type ToolInput,
	type ToolName,
	type ToolOutput
} from '../contracts';
import type { CallContext, Ports, ToolHandlers } from '../ports';
import { quote, searchProducts } from './quote';

type Impl<N extends ToolName> = (
	ports: Ports,
	ctx: CallContext,
	input: ToolInput<N>
) => Promise<Result<ToolOutput<N>>>;

const notYet =
	(slice: string): Impl<ToolName> =>
	async () =>
		err('PROVIDER_UNAVAILABLE', `not implemented yet (core-db ${slice})`);

const IMPLS: { [N in ToolName]: Impl<N> } = {
	search_products: searchProducts,
	quote,
	plan_event: notYet('slice 3'),
	place_order: notYet('slice 2'),
	edit_line: notYet('slice 3'),
	find_substitutes: notYet('slice 4'),
	get_plan: notYet('slice 2'),
	explain_line: notYet('slice 3'),
	approve: notYet('slice 2'),
	commit_order: notYet('slice 2'),
	set_mandate: notYet('slice 2')
};

function invalid(issues: { path: PropertyKey[]; message: string }[]): {
	ok: false;
	error: DomainError;
} {
	return err(
		'INVALID_INPUT',
		issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
	);
}

export function createHandlers(ports: Ports): ToolHandlers {
	const out = {} as Record<
		ToolName,
		(ctx: CallContext, input: unknown) => Promise<Result<unknown>>
	>;
	for (const name of Object.keys(toolSchemas) as ToolName[]) {
		const schema = toolSchemas[name];
		const impl = IMPLS[name] as Impl<ToolName>;
		out[name] = async (ctx, input) => {
			if (!ctx.scopes.includes(schema.scope))
				return err('FORBIDDEN', `${ctx.actor.kind} lacks scope "${schema.scope}" for ${name}`);
			const parsed = schema.input.safeParse(input);
			if (!parsed.success) return invalid(parsed.error.issues);
			return impl(ports, ctx, parsed.data as ToolInput<ToolName>);
		};
	}
	return out as unknown as ToolHandlers;
}
