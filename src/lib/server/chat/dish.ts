/**
 * A dish with a count in the chef's words ("10000 bolongese pasta"), read by the request pipeline's own dish
 * reading (request/dish.ts), so chat and /request read dishes the same way. The chat asks portions-or-packs when
 * the words did not say portions; when they did, it plans the dish straight away.
 */
import { readDish } from '$lib/server/request/dish';

export interface DishReading {
	/** The dish in plain words ("pasta bolognese"). */
	dish: string;
	/** Portions: the count the chef gave. */
	portions: number;
	/** The words said portions ("300 portions", "for 40 people"): nothing to ask. */
	said?: boolean;
	/** A question to ask instead of the default one, when the reading has its own. */
	question?: string;
}

export type InterpretDish = (text: string, ctx: { today: string }) => Promise<DishReading | null>;

export const interpretDish: InterpretDish = async (text) => {
	const r = readDish(text);
	if (!r) return null;
	return {
		dish: r.dish.name,
		portions: r.portions,
		...(r.assumed ? {} : { said: true }),
		...(r.ask ? { question: r.ask.question } : {})
	};
};
