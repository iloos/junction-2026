# PLAN

The only plan. Markers: `[x]` done · `[~]` in progress · `[ ]` todo · `[!]` blocked/risk. Old versions go to `docs/archive/`.

## Phase 0: Prep (before Fri 19:30, no app code)
- [x] Guidebook, rules, schedule, jury → docs/event/
- [x] Stack and patterns → docs/STACK.md; lessons → docs/LESSONS.md
- [x] Repo conventions: CLAUDE.md, AGENTS.md, docs by tense, skills
- [ ] Tooling fixes → docs/TOOLING.md (MCP auth, Modal, extensions)
- [ ] API keys obtained (Anthropic, Gemini AI Studio, Exa, Context.dev; Cala/Verda/Modal coupons at the event) → `.env`
- [ ] Create the GitHub repo (public at submission; private until then is fine)
- [ ] Team on the Junction platform; roles agreed

## Phase 1: Choose (Fri 19:10–22:30)
- [ ] Watch the challenge videos; fill CHALLENGE.md
- [ ] Ideas → score → 30-min spikes on the top 2 → commit (D1 in DECISIONS)
- [ ] **Pre-submission draft by 23:55**
- [ ] Interactive Roadmap board / mockups of the wow ladder (optional; ≤45 min)

## Phase 2: Thin slice (Fri 22:30 → Sat 04:00)
- [ ] Scaffold per STACK.md; ports with fixtures; generator with `--n`
- [ ] `/api/agent` NDJSON stream (fixture → real model)
- [ ] One view rendering generated data at 10× scale
- [ ] Agent proposes ops → UI applies them
- [ ] **Deployed public URL**

## Phase 3: Wow (Sat 04:00 → Sat 22:00)
- [ ] Real data / sponsor APIs replace fixtures, one at a time
- [ ] The "who would have thought" insight
- [ ] Stacked surprises (scale slider, MCP server, Modal fan-out...)
- [ ] `vision-check` at Sat 10:00, 16:00, 22:00
- [ ] Rough video cut by Sat 22:00

## Phase 4: Land (Sat 22:00 → Sun 10:00)
- [ ] Polish pass (impeccable), seeded demo state, no empty states
- [ ] **Feature freeze Sun 06:00**; tag `demo-good`
- [ ] Final video (≤2:00), deck PDF, README, submission → FINAL by 09:30
- [ ] Rehearse the 3:00 pitch ×5; QR card for peer review
