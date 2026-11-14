import { z } from 'zod';
import { Actor, Cents, IsoDate, IsoDateTime, ProductId, Provenance } from './primitives';

/**
 * Open event requests ("5-course dinner for 50 on 20 December"). Three distinct stages, never collapsed:
 * the server's menu module turns a brief into a `MenuProposal` (`proposed`), the chef reviews and edits it
 * (`chef_reviewed`), and only then does `plan_event` turn it into a plan (`planned`). Generation happens in the server
 * (`src/lib/server/menu/**`); core only plans deterministically from an accepted proposal.
 *
 * Every number a model or a rule of thumb produced carries `llm` or `category_estimate` provenance and is shown as an
 * estimate. A chef's edit changes a number's provenance to `user`; it never establishes an allergen or diet fact.
 */

export const ServiceStyle = z.enum(['buffet', 'plated', 'family', 'canape', 'lunch']);
export type ServiceStyle = z.infer<typeof ServiceStyle>;

export const Course = z.enum([
	'starter',
	'soup',
	'fish',
	'main',
	'side',
	'dessert',
	'bread',
	'cheese',
	'drink',
	'other'
]);
export type Course = z.infer<typeof Course>;

/** What the chef asked for, after the brief questions. Bounds keep a typo from planning for 50,000 guests. */
export const EventBrief = z.object({
	title: z.string().min(1).max(200),
	date: IsoDate,
	guests: z.int().min(1).max(2000),
	serviceStyle: ServiceStyle,
	courses: z.int().min(1).max(12).optional(),
	/**
	 * Explicit requirements from the request, normalised ("lactose-free", "vegetarian:6"). They survive every model
	 * revision: a proposal that drops one is invalid, not a new interpretation.
	 */
	dietary: z.array(z.string().min(1).max(60)).max(20).default([]),
	/** Food budget for the event, ex VAT. Advisory: the mandate's caps still decide. */
	budgetCents: Cents.optional(),
	notes: z.string().max(2000).optional(),
	/**
	 * Products the caller already knows for an ingredient ("ribs" → 462201). Tried before the catalogue search; never
	 * past the brief's diet. A hint, not an order: the chef still accepts the menu.
	 */
	hints: z
		.array(z.object({ ingredient: z.string().trim().min(1).max(120), productId: ProductId }))
		.max(30)
		.optional(),
	/** The raw request text and who answered the questions. */
	provenance: Provenance
});
export type EventBrief = z.infer<typeof EventBrief>;

/**
 * One ingredient of a proposed dish. `amountPerCover` is the served amount per guest in `unit`; purchase need is
 * guests × amountPerCover ÷ yield, the formula of the seeded Christmas buffet. Liquids (ml) and pieces are not
 * converted to kg here: sizing converts them only from known pack content, otherwise the need stays unresolved.
 * Exactly one of `productId` (pinned), `query` (retrieval resolves it) or `unresolved` (shown to the chef, never
 * dropped and never guessed).
 */
export const DishIngredient = z
	.object({
		/** Stable within the proposal across revisions; answers and edits attach to it, never to an array index. */
		id: z.string().min(1).max(64),
		label: z.string().min(1).max(120),
		productId: ProductId.optional(),
		query: z.string().min(1).max(120).optional(),
		unresolved: z.string().max(200).optional(),
		amountPerCover: z.number().nonnegative().max(2000),
		unit: z.enum(['g', 'ml', 'pcs']),
		/** Served ÷ purchased, (0, 1]. Absent = assumed 1, and the Why chain says it is an assumption. */
		yield: z.number().gt(0).max(1).optional(),
		/**
		 * Who settled this product: a chef or an agent pinned it, or the menu's chooser picked it from candidates. The
		 * kitchen's next proposals start from it (a person's pin before a model's pick). Absent: the catalogue search's
		 * own best match, remembered nowhere.
		 */
		pinnedBy: z.enum(['chef', 'agent', 'model']).optional(),
		provenance: Provenance
	})
	.refine(
		(i) => [i.productId, i.query, i.unresolved].filter((v) => v !== undefined).length === 1,
		'an ingredient needs exactly one of productId, query or unresolved'
	);
export type DishIngredient = z.infer<typeof DishIngredient>;

export const DishTemplate = z.object({
	/** Stable within the proposal across revisions. */
	id: z.string().min(1).max(64),
	name: z.string().min(1).max(160),
	course: Course.optional(),
	/**
	 * Brief requirements the proposer claims this dish meets. A claim, not evidence: the gate still checks every
	 * resolved product's allergen record, and an unknown record is held, never approved away.
	 */
	claimedCompatible: z.array(z.string()).default([]),
	ingredients: z.array(DishIngredient).min(1).max(20),
	provenance: Provenance
});
export type DishTemplate = z.infer<typeof DishTemplate>;

export const MenuProposalStatus = z.enum(['proposed', 'chef_reviewed', 'planned']);
export type MenuProposalStatus = z.infer<typeof MenuProposalStatus>;

/**
 * A menu for a brief. Each edit is a new `revision`; ids of dishes and ingredients stay stable. Accepted estimates are
 * stored with their status and are not a verified recipe or a reusable knowledge-base entry until reviewed.
 */
export const MenuProposal = z.object({
	id: z.string().min(1).max(64),
	revision: z.int().nonnegative(),
	kitchenId: z.string().min(1),
	status: MenuProposalStatus,
	brief: EventBrief,
	dishes: z.array(DishTemplate).min(1).max(15),
	/**
	 * The server's record of the chef review of this exact revision. Only the server writes it (a review command from
	 * a chef session); `status: chef_reviewed` without it is not a review. Accepting a menu authorises using its
	 * estimates for planning; it does not verify allergens, grant spending authority or make it a trusted recipe.
	 */
	review: z.object({ by: Actor, at: IsoDateTime, digest: z.string() }).optional(),
	/** Requirements the proposal could not meet or questions still open, in our own words. */
	open: z.array(z.object({ id: z.string(), text: z.string().max(300) })).default([]),
	provenance: Provenance
});
export type MenuProposal = z.infer<typeof MenuProposal>;
