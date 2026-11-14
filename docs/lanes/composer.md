# Lane: composer (proposal, for the lead to assign)

**Branch:** `lane/composer` · **Worktree:** `../junc26-lanes/composer` · **Dev port:** 517N · **Owner:** unassigned

## Goal (one sentence, user-visible)
A request typed anywhere in the kitchen ("1,000 L lactose-free milk by Monday") lands in the kitchen's plan as a layer for that delivery, not on a separate page.

## Context to read first (≤4 files)
- docs/concept/SURFACES.md §5 (kinds of work), §6.2 (canvas + composer, closed card catalogue)
- src/routes/request/+page.svelte and src/lib/server/request/ (the existing Request → Lookup → Order → Approval stepper)
- src/routes/(kitchen)/KitchenScreen.svelte

## Owned paths (only these may be edited)
- src/lib/ui/composer/** (new)
- src/routes/(kitchen)/Composer*.svelte (new) and the one mount point in KitchenScreen.svelte
- src/lib/server/request/** (only to return the plan/layer id)
- tests for the above

## Contracts used (read-only; fixtures exist)
- `/api/request` and the request parser; the plan and its lines; `place_order` / `get_plan`.

## Tasks (small; each one ends in a commit)
- [ ] The composer docks at the bottom on the phone and sits under the plan on desktop; it shows the interpreted request (quantity, unit, product family, date) before lookup, as `RequestCard`.
- [ ] The result is a plan the kitchen view can open (deep link `?plan=<id>&line=<id>`); the kitchen shows it as a layer on its delivery day, held lines in the same "Review the order" panel.
- [ ] With a line selected, the composer's request is about that line ("find something Finnish" → find_substitutes with that rule); unsupported requests say so.
- [ ] `/request` stays as the stepper view of the same flow (for the required-flow beat), linking to the plan.

## Acceptance (observable)
- [ ] Typing the milk example on `/` ends with its lines visible in the kitchen plan and its held line in the review panel (screenshot)
- [ ] An unsupported request ("book a table") answers "not something I can order" and creates nothing
- [ ] `pnpm check`, `pnpm test:unit` pass; fixture mode works

## Out of scope
A general chat assistant, voice, photo input, a chat transcript as the record (the op log is the record).

## Needs (requests to the lead; keep working on the fixture meanwhile)
- Agreement with the kitchen lane on the mount point and the review panel API.
