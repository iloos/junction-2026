/**
 * Server features the kitchen screen switches on as they land.
 *
 * SUBSET_APPROVE: core decides only the listed lines of an approval (`approve{lineIds}`; the rest move to a new
 * pending approval; each order line names its group's approval). On: each reason group is granted or kept held on
 * its own. Off: the chef confirms every group on screen, then one grant of the exact terms is sent.
 */
export const SUBSET_APPROVE = true;
