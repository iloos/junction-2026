# Ring 5 checkpoint: one gate, one reading, one surface

_Lead, Sat 14 Nov late. Inputs: every lane's checkpoint (docs/lanes/*.md: core-db, kitchen, ops, f-evals, agent-door-v2, menu-v2, site, site-design, kitchen-profiles, request, o-obs, u-usual, web), Round 11 ([review](../../review/ROUND11-ADVERSARIAL.md)), the user's steers ([USER-DIRECTIVES](../ring4/USER-DIRECTIVES.md)), prod smokes on b10cd43 and 494bd09. Round 12 ([prompt](../../review/ROUND12-PROMPT.md)) amends this when it lands. Steer: converge on the ideal shape; each step lands green and deploys; the freeze only times the video and submission._

## Where we stand
- **The shape moved from patches to invariants.** The four rounds of adversarial review (R9–R11) kept finding three bug classes at each entry: wrong quantity, lost requirement, wrong replay. They are now core invariants:
  - **D16:** one requirement vocabulary plus `meets()` over `facets()`. The 68-product labelled set has 0 unsafe oks.
  - **D18:** every entry makes a need carrying the ask; lines are bound to it (`exceeds_need` forbids, `need_rounding_large` holds); one `commandKey`.
  - **D20:** words read into a general intent shape, with the `request.reading` judge (9/10 reading defects caught), and Flash-Lite plus a 3.8-flash re-read for unsure cases (both 44/45 on held-out paraphrases).
- **Product shape.**
  - Seven joinable kitchens, each with its own event and profile.
  - The request page: editable steps, a date control, a dish path (ready-made vs raw, meat-ratio reasoning), over-limit options, remembered choices.
  - The right rail: Decide on top, collapsed, highlighting its lines; the chat keeps at least 50%.
  - Chat: follows the page's plan, never ends silent, no raw ids, one dish reading shared with /request.
  - The usual order (D14) with simulated history.
  - The product card with verified Valio Aimo listings and photos.
  - Ops: Orders, Demand, rules counts, honest refusal causes.
  - The agent door: absolute links, pairing, refusals that name the failing requirement, one ranking preference across doors.
  - Observability: persisted traces (Postgres, 7 days), request ids, JSON logs (Runtime keeps 24 h). Aiven refuses log shipping from the Runtime app to OpenSearch on our project (403 service_integration_not_allowed for both logs and external_opensearch_logs), so the user held it and is removing mandate-logs; claim no OpenSearch.
- **Prod.**
  - b10cd43 is smoked: 11 passed, the only failures being the /agents prose and a fixed mobile test.
  - 494bd09 (batch 2, with migration 0005 applied) is deploying.
  - Batch 3 is gating: the commit-retry fix, the 5 l hold, the rail rework, the covers sweep, the basket projection and Plan.origin, one ranking.
- **Process.**
  - Lanes now run `--only check,lint` plus targeted tests, and merge-gate enforces it. The lead's main gate is the only full gate.
  - The gate lock queue had 15 waiters; it is cleared.

## Open, by owner (from the lane checkpoints)
- **Core (8d):**
  - `facets()` dairy and gluten by category or name, so "declared but empty" is never lactose-free;
  - an idempotent "already ordered" replay in `commit_order`;
  - R11-04 (replay without a fresh quote), R11-10 (classifier), R10-05/06/08;
  - every place_order line makes a need;
  - the "Valio suggests" contract (K7);
  - a glance at da's substitutes.ts rebase.
- **Conversation (B + E + 41, to merge into one session):**
  - **D15 stage 2:** chat calls the request pipeline for order readings. Today "50 eggs" differs between chat and /request.
  - RequestFlow cards in the transcript, and /request redirecting into chat.
  - The menu-v2 contract (A) and wiring (B), with pins persisted through MenuStore.
  - The dinner-replay eval with live Gemini.
  - Exa grounding in the dish card.
  - Splitting a line across products when stock is short.
  - max_available is seen only via a stand-in model, never live.
- **Kitchen and basket UI (1f + c3, to merge into one session):**
  - mount c3's Basket view and empty state on 9c's basketFor;
  - ProductToken on rows, chips and cards;
  - K7/K8 on Line.unmet[] with diet marks via meets();
  - the Kitchen PRESETS read core rank presets;
  - risks: dishes without lines aren't highlighted, a dock approval shows no "Approved" chip, the rail is untested at 320 px.
- **Ops (9c):**
  - the 'usual' door's origin, now that 7b37e83 is on main;
  - the Sponsors panel on the traces summary;
  - R11-06a/b and R11-07a (with 1f);
  - d0's Ops brief once the user answers.
- **Agent door (da):** Ring 2 (reasoning, report_issue, compact detail); ProductToken listing on lookup_facts/get_product; the risks are PUBLIC_ORIGIN unset, a proxy IP for limits, and in-memory pairing.
- **Evals and claims (91):**
  - the OPEN maps: R11-04a/b, 05, 06a/b, 07a, 10, 15; R10-05/06/08, 09; R8 web;
  - a CLAIMS pass on the deployed batch;
  - the services check turning strict on traces.
- **Site (d0 + 73):** re-record the one-receipt card after the retry fix and the chain after the seed titles; the Ops brief and the app-pages design wait on the user.
- **Lead:**
  - merge batch 3 and deploy;
  - fold in Round 12;
  - the comment sweep;
  - the stray worktrees (`.claude/worktrees/agent-…`, `../agent2-gate`, `junc26-lanes/request-gate`): check them for links before removing;
  - history rewrite and placeholder prices before going public (user).

## Waiting on the user
- PUBLIC_ORIGIN in the Aiven console.
- The Nemotron endpoint (404).
- SMOKE_KEY.
- The history rewrite and placeholder prices before public.
- d0's Ops brainstorm answer and the app-pages design.
- Whether to also reword "cover" in its supply sense ("3 dishes lose cover").

## Session plan for the next ring (proposal)
Peer sessions own durable areas; subagents take bounded jobs.
1. **Core** (8d).
2. **Kitchen and basket UI:** 1f absorbs c3.
3. **Conversation:** a fresh session taking over B, E and 41: chat plus request plus menus, D15 stage 2.
4. **Ops and deploy** (9c).
5. **Evals and claims** (91).
6. **Agent door** (da).
7. **Site** (d0 absorbs 73).

0d retires after the covers sweep. The lead compacts after Round 12 is folded in.
