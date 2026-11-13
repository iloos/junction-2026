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
import type { CallContext, ToolHandlers } from '../ports';
import { editLine, explainLine, planEvent, type ServicePorts } from './events';
import { approve, commitOrder, getPlan, placeOrder } from './orders';
import { quote, searchProducts } from './quote';
import { findSubstitutes } from './substitutes';

type Impl<N extends ToolName> = (
	ports: ServicePorts,
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
	plan_event: planEvent,
	place_order: placeOrder,
	edit_line: editLine,
	find_substitutes: findSubstitutes,
	get_plan: getPlan,
	explain_line: explainLine,
	approve,
	commit_order: commitOrder,
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

export function createHandlers(ports: ServicePorts): ToolHandlers {
	const out = {} as Record<
		ToolName,
		(ctx: CallContext, input: unknown) => Promise<Result<unknown>>
	>;
	for (const name of Object.keys(toolSchemas) as ToolName[]) {
		const schema = toolSchemas[name];
		const impl = IMPLS[name] as Impl<ToolName>;
		out[name] = async (ctx, input) => {
			if (!ctx.scopes.includes(schema.scope))
				return err('FORBIDDEN', `${ctx.actor.kind} lacks scope "${schema.scope}" for ${name}`, {
					sub: 'scope'
				});
			const parsed = schema.input.safeParse(input);
			if (!parsed.success) return invalid(parsed.error.issues);
			try {
				return await impl(ports, ctx, parsed.data as ToolInput<ToolName>);
			} catch (e) {
				// A throw is a bug on our side, never the caller's: report it as INTERNAL, not a crash.
				return err('INTERNAL', `${name}: ${e instanceof Error ? e.message : String(e)}`);
			}
		};
	}
	return out as unknown as ToolHandlers;
}
