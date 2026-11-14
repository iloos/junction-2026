# Ring 3 synthesis: land the hero path, make it act, tell the truth

_Lead, Sat 14 Nov evening. Inputs: [review-code](review-code.md), [review-agent-sponsors](review-agent-sponsors.md), [review-docs-criteria](review-docs-criteria.md), [review-product](review-product.md), [review-ux](review-ux.md) (when it lands), the design session's [ui-mockset-to-prod](../ui-mockset-to-prod.md) and [memory-and-tenancy](../memory-and-tenancy.md), and [BUGS](../../BUGS.md). Everything below lands before the Sun 06:00 freeze; the last stretch before 06:00 is fixes, video and rehearsal only._

## Where we stand
- **The trust core holds** (every review, verified): one write path (`applyOps`), one tool gate (`serveTool`), approvals bound to plan version + terms hash, idempotent commit, judge keys that can't approve. Five reviewers found no way past it.
- **Valio rubric ≈ 3.4/5.** Strongest: Autonomy and controls, Robustness. Weakest: end-to-end demo (30 of 100) and user need.
- **The seams are the problem, not the core.** Two async scopes (workspace clock/run vs outside-call spend/trace) that entry points enter one of; two next-action rules; two task-id formats; three orchestrators.
- **The demo's hardest risk is the open menu.** The resolver maps whitefish → breaded chicken and a vanilla pod → sausage. B's resolve fixes are on main but not yet on prod: re-check after the next deploy.
- **The docs under-claim and lag** (A4, cut-off at commit, Exa in Why, chat v2 are all live), and the judge-facing files (README, submission texts) don't exist yet.

## Decisions taken here
1. **The wow is the hero moment acting** (product #1): when another kitchen takes the ham, the agent re-rescues and applies the split; the part that breaks "meat: Finnish preferred" goes to sign-off; the earlier approval voids with the diff; Ops shows the case. All pieces exist.
2. **One call scope at every door** (code H2/M1/M2): `withCallScope(ctx, fn)` = `ensureRunLoaded` + `inWorkspace` + `withExternalScope`, and the ctx's `runId` refreshed from it. `realHandlers()` becomes private; every route uses the wrapped handlers.
3. **One next-action rule, in core** (code H3, agent #1): 8d's `nextActionFor` with `change_date`; `LineView.nextAction` agrees; approved-but-held lines read "commit"; E's stand-in callers switch.
4. **Server-owned idempotency keys** for model-planned orders (agent #2), and the understanding guard covers adjust and order→smalltalk (agent #4).
5. **Open menu is fenced** until the resolver refuses category mismatches; out of the video until a prod re-check passes.
6. **SetMandate op: not before the freeze.** Fix the schema comment instead and don't claim mandate history (8d's assessment stands for after).
7. **Kitchen layout: B (plan first) direction, no restructure**; take its deltas (#1 dish sentence, #2 chat turn, #8 what changed).
8. **Sponsor entries:** Valio, Gemini, Aiven for sure; Context.dev tech only if a recall drill visibly holds a line in the visitor's order; Exa mentioned for the Why-drawer evidence once seen on prod.

## Batches (in order; owners)
**B1 · Seams and guarantees** (now)
- E: server-owned keys, the guard on adjust/smalltalk, one claim checker; chat task-id regex (H1); chat routes on wrapped handlers (H2); `/api/agent/run` in scope (M1).
- Lead: `withCallScope`, private `realHandlers`, dead stub code out of prod paths (cleanup 1–2, 5).
- 9c: `onCurrentRun` always refreshes the run id (M2).
- 8d: rebase a-atp; core `change_date` + approved-held → commit; served basis.
- D-work (lead or E): Gemini text calls through the external helper with a daily cap and a trace (agent #3).

**B2 · Hero path dramatic and safe**
- 8d + 1f: contention → re-rescue → split → sign-off → voided diff → Ops case (the wow).
- 1f: first screen shows the event, the two outages and the mandate before the click (or auto-plans); Wave 1 #1 dish sentence, #2 chat turn, #8 what changed; "known stock first" band label; "sold in 10 kg cases" on rounded rows.
- B (resume): resolver category guards; prod re-check of the open menu.
- 9c: Wave 1 #3 consequence-first cases, #5 Engine room, #4 case story; Ops order (held first, "nothing held" recalls grey); product names, never ids.
- Words (each S): "confirmed by the simulated supplier"; no raw plan ids in chat; "Drafted an order with 0 lines" gone.

**B3 · Truth, docs, submission**
- 91: PITCH/CLAIMS truth pass; prod re-test after each deploy; claims observed on prod.
- Design session: judge-facing README draft.
- Lead: submission texts (`docs/SUBMISSION.md`: name, punchline, description, Valio, Gemini four questions, Aiven, Context.dev/Exa if entered); ARCHITECTURE refresh (17 tools, migrations 0003–0004, chat/tasks/review); CLAUDE.md routes; five-second rule as hard rule 12 with measurable checks; SCORECARD as re-runnable checks; archive ring2 handoffs, stale briefs and dead prep docs; remove `docs/research/sibling-repos.md`.
- Before public: history squash (secrets in old commits), Valio key rotation question to Valio.

**B4 · Wave 2 (only after B1–B2 are deployed and checked)**
- Memory as a projection of the op log (patterns + a cited `get_context` slice + "what we know" panel), forecast "will stock hold?" read-only, `/story` + `/how` static pages.

**Last stretch:** video on prod against CLAIMS "say it" rows, the 3-minute script from [review-product](review-product.md), tag the commit, no redeploy in the last 30 minutes, rehearse at 1440 and on a phone.

## Criteria
Keep the SCORECARD's judging map, but make every mark re-runnable: evals/ui green on prod with 0 blockers; paraphrase and chat-free pass rates; the adversarial suite at 100%; a DOM-text grep for `ws-j-`, `pl-run-`, op names and ISO dates on judge pages = 0; first decision above the fold at 390 px; OpenAPI validates; tool count matches `/agents`.
