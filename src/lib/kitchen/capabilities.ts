/**
 * Server features the kitchen screen depends on that land separately from it.
 *
 * SUBSET_APPROVE: core decides only the listed lines of an approval (`approve{lineIds}`, the rest moving to a new
 * pending approval). The contract has the field, but until core implements the split a `lineIds` grant would grant
 * every line, so the panel instead has the chef confirm each reason group on screen and then sends one grant for
 * all confirmed groups, worded as one decision. Flip to true when core's approve splits (with its 3-group test).
 */
export const SUBSET_APPROVE = false;
