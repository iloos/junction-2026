# PLAN

The only plan. Markers: `[x]` done · `[~]` in progress · `[ ]` todo · `[!]` blocked/risk. Edit only your own lines; the lead owns the structure. Who owns what, and what is merged: [DISPATCH.md](DISPATCH.md).

## Now (Sat 14 Nov)
- [x] T0 and T0.1 contracts (supply tier D8, visitor identity D9, vocabulary and lineage D10)
- [x] Wave "Now": request parser and constraint fixes · agent unit/date guard and `get_context` · web cache, schema, drill · visitor resolver · regression evals · A1
- [~] Integration 1: two browsers and an MCP client complete the milk flow, each in its own workspace; Ops opens the exact plan (merged; deployed run open)
- [~] Integration 2: physical quantities and supplier-confirmed vs unknown supply agree on every surface (A2, C1 merged; A2b approve per reason group, A3 cut-off at commit, E outcomes open)
- [ ] Integration 3: one arbitrary dinner → reviewed menu proposal → editable, explained, safely held plan (B menu proposal [~], A4 [ ], D evidence UI [ ])
- [~] **Review mechanism:** a validator at each model-output checkpoint (request parse, menu proposal, agent outcome, explanations): pass, revise once with the critique, or block with the reason. Never authorises, never overrides the gate; Gemini Decisions, traced and capped; behind a flag until evals show it helps. Owner E (`src/lib/server/review/`): outcome text and request parse on `lane/e-agent`, menu proposal next. Every track: rubric + eval before merge.
- [ ] Video checkpoint Sat 22:00: green deployable tag; sponsor claims (Exa, Context.dev) decided from observed journeys
- [ ] Next scope: **in-app agent chat and tooling** (the chef talks to the same agent, through the same gate)
- [ ] Next scope: **UI/UX pass** over Kitchen, Request, Ops and `/agents`, one vocabulary ([concept/VOCABULARY.md](concept/VOCABULARY.md))
- [ ] Later: extension scopes from [concept/GROWTH.md](concept/GROWTH.md), only once the freeze plan is safe

## Land (Sunday)
- [ ] **Feature freeze Sun 06:00**; tag `demo-good`; deploy the tag untouched (experiments on branches only)
- [ ] Polish pass: seeded demo state, no empty states, labels (real / cached / simulated) visible
- [ ] Final video ≤ 2:00 (1080p, voice-over, burned-in captions; unlisted YouTube, public at submission) · deck PDF (6 slides) · README
- [ ] Platform: set the real drafts (Valio Aimo, Context.dev, Exa, AfterQuery, S-Pankki as decided) to **Final** by 09:30; leave placeholders as drafts; hard deadline Sun 10:00
- [ ] Platform descriptions: drop "data stays in Finland"; claim only what [PITCH.md](PITCH.md) lists as provable
- [ ] **Public repo scrub** before flipping to public:
  - [ ] Valio API key and redeem codes out of `docs/event/challenges/` (and anywhere else: `git grep` for the key and codes)
  - [ ] Squash history so removed secrets are not in any commit
  - [ ] Trim hallway quotes in `docs/research/mcpcon.md`
  - [ ] No Valio dataset files committed (only `fixtures/seeds/` samples); confirm redistribution of the samples
  - [ ] `.env.example` names only; no keys in docs, fixtures or tests
- [ ] Rehearse the 3:00 pitch ×5; QR card for the peer-review table (Sun 10:30)
- [ ] Demo safety: phone hotspot; `pnpm build && node build` with `LLM_PROVIDER=fixture`; a recorded demo video on the laptop
