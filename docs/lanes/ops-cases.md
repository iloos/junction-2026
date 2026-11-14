# Lane: ops-cases (proposal, for the lead to assign)

**Branch:** `lane/ops-cases` · **Worktree:** `../junc26-lanes/ops-cases` · **Dev port:** 517N · **Owner:** unassigned (natural fit: the ops session)

## Goal (one sentence, user-visible)
Operations shows one case per cause (an outage, a recall, a held event), spanning however many kitchens it touches, ranked by € at risk × time to cut-off.

## Context to read first (≤4 files)
- docs/concept/SURFACES.md §4 (Case), §6.3, §2b (PagerDuty grouping, Lokad/Zendesk ranking)
- src/routes/ops/cases.test.ts and Queue.svelte (cases are per line today)

## Owned paths (only these may be edited)
- src/routes/ops/** and tests

## Contracts used (read-only; fixtures exist)
- Op stream, plans and `LineView`; the existing case → plan/version deep link.

## Tasks (small; each one ends in a commit)
- [ ] Group line cases by cause: same product outage, same recall, same held layer + reason; one row lists the kitchens and lines inside and says why they were grouped.
- [ ] Rank by € at risk (held/unsupplied line value) × time to the earliest cut-off; show both numbers.
- [ ] Verbs: take (owner), message kitchen, snooze until change, close only with coverage evidence.
- [ ] Expanding a case shows its lines; each still deep-links to the exact plan at its version.

## Acceptance (observable)
- [ ] With the multi-kitchen simulator run, the ham outage shows as one case across kitchens (screenshot)
- [ ] Sorting by risk × time puts the earliest expensive cut-off first (test)
- [ ] `pnpm check`, `pnpm test:unit` pass

## Out of scope
Ops approving for a kitchen (never); new event kinds.

## Needs (requests to the lead; keep working on the fixture meanwhile)
- None expected.
