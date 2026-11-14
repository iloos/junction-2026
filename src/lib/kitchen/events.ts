/**
 * Each kitchen's event, in one place: the seed files under fixtures/seeds, keyed by the kitchen they belong to.
 * The kitchen screen plans this event for the kitchen it shows, so switching kitchen shows that kitchen's event and
 * basket. Every seeded kitchen has one; a kitchen without one (joined later, its first plan from the chat) still
 * opens, with no event to plan.
 * Imported by the server (event ports, live screen) and the in-browser fixture alike: no server-only code here.
 */
import xmas from '../../../fixtures/seeds/christmas-buffet-140.json';
import lounas from '../../../fixtures/seeds/lounas-wednesday-320.json';
import school from '../../../fixtures/seeds/school-day-2000.json';
import alacarte from '../../../fixtures/seeds/alacarte-friday-120.json';
import carehome from '../../../fixtures/seeds/carehome-week-140.json';
import cafe from '../../../fixtures/seeds/cafe-weekend-800.json';
import skiresort from '../../../fixtures/seeds/skiresort-opening-550.json';

/** The fields the screens read from an event seed (the full shape is `EventSeed` in core/demand/event-seed). */
export interface EventSeedFile {
	id: string;
	title: string;
	kitchenId: string;
	date: string;
	guests: { estimate: number; guarantee: number | null };
	serviceStyle: string;
	dishes: { dish: string; productId: string; realOutage?: boolean }[];
	rescue?: Record<string, unknown>;
}

export const EVENT_SEEDS: EventSeedFile[] = [
	xmas,
	lounas,
	school,
	alacarte,
	carehome,
	cafe,
	skiresort
] as unknown as EventSeedFile[];

export const EVENT_SEED_BY_ID: Record<string, EventSeedFile> = Object.fromEntries(
	EVENT_SEEDS.map((e) => [e.id, e])
);

/** The event the kitchen screen plans for this kitchen; undefined when it has none. */
export const eventFor = (kitchenId: string): EventSeedFile | undefined =>
	EVENT_SEEDS.find((e) => e.kitchenId === kitchenId);

/** Whether the kitchen has a seeded event to plan (else its plans come from the chat or an agent). */
export const hasEvent = (kitchenId: string): boolean => eventFor(kitchenId) !== undefined;
