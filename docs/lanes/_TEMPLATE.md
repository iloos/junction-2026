# Lane: <name>

**Branch:** `lane/<name>` · **Worktree:** `../junc26-lanes/<name>` · **Dev port:** 517N · **Owner:** <person> / <agent session>

## Goal (one sentence, user-visible)

## Context to read first (≤4 files)
- docs/concept/CONCEPT.md, the section on ...
- docs/concept/ARCHITECTURE.md, the section on ...
- src/lib/core/types.ts, src/lib/ports/<x>.ts

## Owned paths (only these may be edited)
- src/lib/<area>/**
- src/routes/<area>/**
- tests for the above

## Contracts used (read-only; fixtures exist)
- `XPort` (fixture: `fixtures/x/*.json`)

## Tasks (small; each one ends in a commit)
- [ ] ...

## Acceptance (observable)
- [ ] `pnpm check` passes
- [ ] <route> at http://localhost:517N shows ... (Playwright screenshot in `scratch/`)
- [ ] Works with `LLM_PROVIDER=fixture`

## Out of scope
-

## Needs (requests to the lead; keep working on the fixture meanwhile)
-

## Report (the lane agent appends at the end of each run)
- <time> · done: … · stubbed: … · needs: … · ready to merge: yes/no
