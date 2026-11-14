# PLAN

The only plan. Markers: `[x]` done · `[~]` in progress · `[ ]` todo · `[!]` blocked/risk. Edit only your own lines; the lead owns the structure.

## Now: rings (D4). This section supersedes the phases below where they differ
- [x] Concept, research, foundations, Valio probe, outside reviews, platform drafts (Fri night)
- [x] **Contracts commit** (lead): ARCHITECTURE.md, types, Drizzle schema, ports + fixtures, tool registry, eval format, lane-setup (`bb8c78e`, review fixes `a3a97b2`)
- [~] **Lanes**: core-db (slices 1–3 merged, slice 4 next) · agent [x] · kitchen [x] fixture, live flip next · ops [x] · deploy [~] Runtime building · jobs [ ]
- [x] Aiven Postgres migrated + seeded (17,546 products, 11,269 offers)
- [ ] **Ring 0 tracks** (review 01:55, docs/reviews/2026-11-14-0155.md): R0-a rank + make_in_house · R0-b kitchen live flip · R0-c Request (Valio's NL order flow) · R0-d demo hygiene (scenario clock, reset run, deployed smoke) · R0-e Postgres double-commit race test · R0-f agent run route + trace drawer · R0-g external agent on stage (MCP client)
- [ ] **Ring 0 deployed** by Sat ~08:00–10:00: Christmas buffet for 140 (ham 462490 and lanttulaatikko 462482 really out), event as a diff, rescue with a visibly rejected substitute, mandate + exact-term approval + idempotent commit, external agent through the same gate, why drawer (PRODUCT.md, 8 stories)
- [ ] Ring 1 (Operations, Context.dev change, Exa discovery) · Ring 2 (Lab/evals, Modal jobs, Gemma/Verda) · Ring 3 (Personal for S-Pankki, Nemotron documents)
- [ ] **Showcase if time: "estimate any kitchen"** (GROWTH.md): discovery map/list over 3,560 venues with readiness, one venue's sourced estimate, owner context upgrades it; purchasing stays on the verified kitchens
- [ ] Rough video Sat 22:00 · feature freeze Sun 06:00 · drafts → FINAL by 09:30

## Later roadmap (not a priority now; keep the seams in the contracts)
- **Multi-user and multi-tenant:** workspaces (kitchen, chain, Valio ops), users with roles (chef, purchaser, approver, ops), auth (Better Auth on SvelteKit), every record and op carries `workspaceId` + `actor`.
- **Memory:** per-kitchen memory of preferences, accepted/rejected substitutes, learned rules and past events, stored server-side and used by the agent (with provenance, editable by the kitchen).
- **Shared server-side work:** enrichment, normalisation, caches and web monitors run once on the server and benefit every kitchen (no per-client recomputation).
- **Many clients:** many agents (MCP/REST) and UIs at once; per-key rate limits and quotas; stateless server so it scales horizontally.
- **No collisions or double orders:** idempotency keys on every commit; approvals bound to a terms hash + version; stock reservation as an atomic conditional update in one transaction (`... where available >= qty`), optimistic concurrency on plans; cumulative spend caps checked inside the same transaction.


## Roles (fill in Fri 19:30)
| Role | Who | Owns |
|---|---|---|
| Lead / integrator | solo builder + the lead Claude session | `main`, merges, STATUS.md, `core/` + `ports/` contracts, deploy |
| Viz / UI | | views, d3/3D, design direction (PRODUCT.md / DESIGN.md), polish |
| Agent / data | | LLM port, tools, data generator plus fixtures, sponsor adapters |
| Pitch / story | | PITCH.md, deck, video, peer-review table, workshop notes |

Solo or 2–3 people: merge roles in this order: lead+agent, viz, pitch. **Pitch:** one presenter on stage with the handheld mic who drives the demo themselves (rehearse that). Teammates stay at the laptop only if allowed.
**Workshops:** Cala Sat 11:00 · Modal 13:30 · Exa 16:30 · Context.dev 17:30. One person each, notes into `docs/event/notes-<sponsor>.md`, and only for sponsors we use.

## Shifts (you can't sleep at the venue; the metro stops ~00:00)
**Solo:** lanes run in auto mode while you sleep, against strict briefs and fixtures; the lead integrates what's green. The table below was written for four people and no longer applies.
| Window | Who's on | Who sleeps (off-site) |
|---|---|---|
| Fri 19:30–Sat 02:00 | all | — |
| Sat 02:00–07:00 | A + B | C + D |
| Sat 07:00–12:00 | C + D | A + B |
| Sat 12:00–Sun 10:00 | all (power naps in the lounges) | — |
Transport owner: ___ (night bus or taxi; see guidebook).

## Phase 0: Prep (before Fri 19:30, no project code)
- [x] Event facts, jury, sponsors → docs/event/
- [x] Stack, building blocks, lessons, conventions, skills
- [x] GitHub repo (private until submission)
- [ ] Tooling fixes → TOOLING.md "do before 19:30"
- [ ] API keys into `.env`, with a spend cap set in each console
- [ ] Team registered on the platform; roles filled in above
- [ ] Ask in Discord on Friday for Cala / Verda / Modal / Featherless access (don't wait for Saturday workshops)

## Phase 1: Concept (Fri 19:10 → ~Sat 00:30). Think hard first; see ORCHESTRATION.md
- [ ] Challenge videos → CHALLENGE.md; ask the mentors the CHALLENGE.md questions
- [x] **Background agent, from 19:30:** scaffold (adapter-node + Dockerfile, D3); not deployed yet
- [ ] Diverge (brainstorming) → research subagents → `docs/research/*.md`
- [x] Decided without `idea-pick`: Valio (D1), concept v2.1 after the stand
- [x] **Pre-submission draft by 23:30** (8 drafts, see STATUS)
- [ ] `docs/concept/CONCEPT.md` (product, wow ladder, scope) + design direction (`PRODUCT.md` / `DESIGN.md` at the root, 15 min)
- [ ] `docs/concept/ARCHITECTURE.md` (data model, ops, ports, routes, lanes)
- [ ] **Contracts commit** by the lead: core types and ops, ports, fixtures, generator stub → `main`

## Phase 2: Lanes, thin slice (~Sat 00:30 → 06:00, cut-off 08:00)
- [ ] `integrate` skill: lane briefs, worktrees, lane sessions in auto mode
- [ ] Each lane hits the acceptance checks on fixtures
- [ ] First integration: an end-to-end slice on `main`, deployed

## Phase 3: Lanes, wow (Sat 06:00 → Sat 22:00; integrate every ~90 min)
- [ ] Real data / sponsor APIs replace fixtures one at a time; **record a fixture the moment each key works**
- [ ] The "who would have thought" insight
- [ ] Stacked surprises (scale slider, MCP server/App, Modal fan-out...)
- [ ] `vision-check` skill at Sat 10:00, 16:00, 22:00
- [ ] Rough video cut by Sat 22:00

## Phase 4: Land (Sat 22:00 → Sun 10:00; lanes collapse, `main` only)
- [ ] Polish pass (impeccable if installed), seeded demo state, no empty states
- [ ] **Feature freeze Sun 06:00**; tag `demo-good`
- [ ] Final video ≤2:00; deck PDF; README; repo made **public**; submission → FINAL by 09:30
- [ ] Rehearse the 3:00 pitch ×5; a QR card for the peer-review table

## Data
- Owner: agent/data. One generator script with a fixed seed. Demo size **N** and stress size **10N**. Realistic distributions, including a planted "insight" the demo can reveal (and real data for that wherever we have it).
- Each sponsor response is saved to `fixtures/<sponsor>/*.json` the first time it works.

## Demo safety (if Wi-Fi or APIs die)
- Phone hotspot ready. `pnpm build && pnpm preview` runs locally with `LLM_PROVIDER=fixture`.
- A pre-recorded demo video on the laptop desktop.
- Tag `demo-good` deploys untouched; experiments go on branches after the freeze.

## Video and deck
- Video owner: pitch. Capture with OBS (or the Windows Game Bar) at 1080p, with voice-over through a headset mic and burned-in captions. Upload unlisted to YouTube; make it public at submission. ≤2:00 exactly.
- Deck: 6 slides as a PDF (problem, demo screenshot, how it works, sponsors used, impact/business, team). Keep it light; the demo carries the pitch.
