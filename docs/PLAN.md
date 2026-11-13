# PLAN

The only plan. Markers: `[x]` done · `[~]` in progress · `[ ]` todo · `[!]` blocked/risk. Edit only your own lines; the lead owns the structure.

## Roles (fill in Fri 19:30)
| Role | Who | Owns |
|---|---|---|
| Lead / integrator | | `main`, merges, STATUS.md, `core/` + `ports/` contracts, deploy |
| Viz / UI | | views, d3/3D, design direction (PRODUCT.md / DESIGN.md), polish |
| Agent / data | | LLM port, tools, data generator plus fixtures, sponsor adapters |
| Pitch / story | | PITCH.md, deck, video, peer-review table, workshop notes |

Solo or 2–3 people: merge roles in this order: lead+agent, viz, pitch. **Pitch:** one presenter on stage with the handheld mic who drives the demo themselves (rehearse that). Teammates stay at the laptop only if allowed.
**Workshops:** Cala Sat 11:00 · Modal 13:30 · Exa 16:30 · Context.dev 17:30. One person each, notes into `docs/event/notes-<sponsor>.md`, and only for sponsors we use.

## Shifts (you can't sleep at the venue; the metro stops ~00:00)
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
- [ ] **Background agent, from 19:30:** scaffold per STACK.md → empty app deployed on Vercel (D0d)
- [ ] Diverge (brainstorming) → research subagents → `docs/research/*.md`
- [ ] `idea-pick` → spikes on the top 2 → decide by ~22:30 (D1)
- [ ] **Pre-submission draft by 23:30**
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
