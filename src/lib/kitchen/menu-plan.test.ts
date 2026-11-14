import { describe, expect, it } from 'vitest';
import { menuDishes, menuTitle, splitNeed, startsDish } from './menu-plan';

const names = [
	'Gravlax with dill and rye crisp · salmon fillet',
	'Gravlax with dill and rye crisp · dill',
	'Green salad · salad leaves',
	'Green salad · tomato',
	'Pike-perch with butter potatoes · pike-perch'
];

describe('menu plan', () => {
	it('splits a need into dish and ingredient', () => {
		expect(splitNeed(names[0])).toEqual({
			dish: 'Gravlax with dill and rye crisp',
			part: 'Salmon fillet'
		});
		expect(splitNeed('Milk')).toEqual({ dish: null, part: 'Milk' });
	});
	it('titles the menu by its dishes, not its ingredients', () => {
		expect(menuDishes(names)).toHaveLength(3);
		expect(menuTitle(names)).toBe(
			'Menu, 3 dishes: Gravlax with dill and rye crisp, Green salad and 1 more'
		);
		expect(menuTitle(['Milk', 'Eggs'])).toBeNull();
	});
	it('marks where each dish starts', () => {
		expect(names.map((_, i) => startsDish(names, i))).toEqual([true, false, true, false, true]);
	});
});
