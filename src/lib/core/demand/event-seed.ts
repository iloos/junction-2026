import { z } from 'zod';
import { ProductId, UnitCode } from '../contracts/primitives';

/**
 * Usable content of one sales unit. Exactly one shape applies per product:
 * net kg, gross + drained kg (served drained), net litres, or pieces with their net kg.
 */
export const SeedPack = z.looseObject({
	netKg: z.number().positive().optional(),
	grossKg: z.number().positive().optional(),
	drainedKg: z.number().positive().optional(),
	netL: z.number().positive().optional(),
	pieces: z.int().positive().optional()
});
export type SeedPack = z.infer<typeof SeedPack>;

/** Ingredient amounts per kg of a cooked dish (e.g. porridge: rice kg and milk l per kg). */
export const PerKgDish = z.record(z.string(), z.number().nonnegative());

const SeedOrder = z.looseObject({
	qty: z.number().nonnegative(),
	unit: UnitCode,
	rounding: z.string().optional()
});

export const SeedDish = z.looseObject({
	dish: z.string().min(1),
	/** Grams served per guest, as on the plate. Absent when the need derives from another entry. */
	gServed: z.number().nonnegative().optional(),
	/** Served weight ÷ purchased weight; 1 when absent. */
	yield: z.number().positive().optional(),
	perKgDish: PerKgDish.optional(),
	productId: ProductId,
	salesUnit: UnitCode,
	/** Catch-weight lot step in sales units (KG). */
	lotStep: z.number().positive().optional(),
	pack: SeedPack.optional(),
	needKg: z.number().nonnegative().optional(),
	needL: z.number().nonnegative().optional(),
	order: SeedOrder.optional(),
	editCheck: z
		.looseObject({
			gServed: z.number().nonnegative(),
			needKg: z.number().nonnegative(),
			order: SeedOrder
		})
		.optional()
});
export type SeedDish = z.infer<typeof SeedDish>;

export const EventSeed = z.looseObject({
	id: z.string().min(1),
	title: z.string(),
	kitchenId: z.string().min(1),
	date: z.iso.date(),
	guests: z.looseObject({ estimate: z.int().positive(), guarantee: z.int().positive().nullable() }),
	dishes: z.array(SeedDish).min(1)
});
export type EventSeed = z.infer<typeof EventSeed>;
