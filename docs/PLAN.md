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
- [ ] **Agent door v2** ([lanes/agent-door-v2.md](lanes/agent-door-v2.md), D17): approve from any device (absolute links, pairing, dock approve cards) · `revise_menu` with product pins · questions before guessing · `reasoning` + `report_issue` · compact results
- [ ] Next scope: **UI/UX pass** over Kitchen, Request, Ops and `/agents`, one vocabulary ([concept/VOCABULARY.md](concept/VOCABULARY.md))
- [ ] Later: extension scopes from [concept/GROWTH.md](concept/GROWTH.md), only once the freeze plan is safe

## Land (Sunday) — ring 6 timetable
- [~] Waves every ~1.5 h until 05:00 (gate → push → S4 deploys → lead smokes → S5 playtests); 05:00–06:00 fixes only
- [ ] **Feature freeze Sun 06:00**: tag `demo-good` on the last green, smoked deploy; no redeploy after 09:30
- [ ] **Demo state before judges:** presenter resets the shared room `ws-judges` (smokes and playtests leave "Playtest Room …" stores there); check the room's QR shows app.mandate.kitchen; seed nothing else
- [ ] **06:00–09:00 (no features):** public-clone fixture + clean-clone smoke (F11, S5+S1) · CLAIMS → SUBMISSION → PITCH truth pass on the tagged SHA (S5) · README tour · comment sweep
- [ ] Final video ≤ 2:00 (1080p, voice-over, burned-in captions; unlisted YouTube, public at submission), shot list from S5: hero journey first, then the room + shortage, then an outside agent stopped · deck PDF (6 slides) · README
- [ ] Platform: real drafts to **Final** by 09:30 (Valio Aimo, Gemini, Aiven, Context.dev, Exa as decided); hard deadline Sun 10:00
- [ ] Claims: never "live warehouse stock" (Valio's API is a static snapshot; movement is simulated and labelled); never "data stays in Finland"
- [ ] **Public repo scrub** before flipping to public (user):
  - [ ] rotate the judge keys and SMOKE_KEY (pasted in lane chats)
  - [ ] Valio API key and redeem codes out of `docs/event/challenges/`; `git grep` for keys and codes
  - [ ] the working tree is clean (S7, 02:00), but the Valio key and codes are still in history (b526a62, on the private origin). Don't flip this repo public: publish a **fresh public repo** from the tagged tree as one squashed commit (no filter-repo on the shared history the lanes use); placeholder Valio prices; also redact the Cala promo code (`docs/event/challenges/main/cala--*.md:74`) and atech's code (`tech/*atech*.md:101`)
  - [ ] trim hallway quotes in `docs/research/mcpcon.md`; no Valio dataset files beyond `fixtures/seeds/`
  - [ ] `.env.example` names only
- [ ] Rehearse the 3:00 pitch ×5; QR card for the peer-review table (Sun 10:30)
- [ ] Demo safety: phone hotspot; `pnpm build && node build` with `LLM_PROVIDER=fixture`; a recorded demo video on the laptop
