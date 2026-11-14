# Lane: agent-door-v2

**Branch:** `lane/agent-door-v2` · **Worktree:** `../junc26-lanes/agent-door-v2` · **Dev port:** 5192 · **Owner:** lead-approved session (continues [agent-door](agent-door.md))

## Goal
Make Mandate the best door for an agent to buy for a kitchen. The chef can act on what the agent proposes from wherever they are, the agent can never act for the chef, and each step costs the agent one obvious call.

## Why (what a real session showed, 14 Nov)
A Claude Code session planned a 7-guest dinner over MCP and hit these problems:
- **The chef had nowhere to approve.** `meta.approvalUrl` is relative (`/?kitchen=…`, built in `tools/present.ts`). It only opens the sandbox in the one browser holding the visitor cookie, and a menu proposal has no review link at all.
- **Fixing one ingredient regenerated the whole menu.** `editMenu` exists on the server but isn't an MCP tool and can't pin a product. The rerun lost two products it had already matched (pork belly, chipotle) and invented a blocking issue (a dish labelled `side`, so 5 courses asked, 4 proposed).
- **The agent couldn't pass on what it knew.** It had found backribs (462201) by search and had no way to hand that to `propose_menu`.
- **The tools never asked about the guests.** Lactose, pork and allergies only came up because the agent thought of them.
- **Answers are heavy.** `search_products` costs about 2–3k tokens per 5 hits (CO₂, baseKey, the pack table), and `propose_menu` repeats full provenance on every ingredient.
- **The tools didn't say why, or report misses.** Writes carry no intent, and the missing ribs and kassler-for-pibil left no trace anyone could fix.

## Principles (each one is checked by an acceptance line below)
1. **Links point; only the human grants.** A URL the agent receives carries no authority. Authority reaches the human by a channel the agent never sees: their own browser session, a device they paired, and later their login.
2. **Every result is a place to go.** Each `meta` link is absolute, and the instructions tell the agent to give the human the link first.
3. **Revise, don't regenerate.** Menus and plans change one edit at a time, with the revision checked (`STALE_VERSION`).
4. **Ask before guessing.** A brief that leaves out diet, allergens or the guests returns questions, not a menu.
5. **Say why; report misses.** Writes carry `reasoning`, shown in the agent-changes feed. Data the agent finds wrong goes to `report_issue` and appears in `/ops`.
6. **Cheap by default, deep on demand.** `detail: "compact" | "full"`, with compact as the default.

## Prior art (connected MCP servers, read 14 Nov)
| Server | Pattern | Here |
|---|---|---|
| Aiven `pg_write` | Required `reasoning` (intent, no PII) for audit; separate read and write tools | `reasoning` on write tools, shown in the feed |
| Verda `create_vm` | `confirm: true` gate with `CONFIRMATION_REQUIRED`; typed codes + `details`; "accepted" ≠ "completed"; prices are estimates | The contrast for the pitch: Verda's confirm is a flag the model sets, Mandate's approve is a human act. Keep refusals typed with `details`. |
| Context.dev `submit-feedback` | The agent reports wrong or incomplete data once, sanitised, with a request id | `report_issue` → catalogue gaps in `/ops` |
| Firecrawl | `toolDetail` compact/full; required `objective`; `conversationId` across stateless calls | `detail` param; `objective` on the menu brief |
| Better Stack `query_windows` | A preflight that returns a decision (run / split / can't size) plus notes | `dryRun` on `place_order`: what would be ordered, held and why, with nothing written |
| Atlassian Rovo | `cloudId` derived from the token; cost stated in the tool description | Ring 4: workspace from the token; limits stated in descriptions |
| Claude Docs | Create first, return the link, "open it" | Principle 2 |

## Rings (each one ships on its own and leaves main green)

### Ring 1: approve from anywhere
- [ ] **Absolute links.** Add `PUBLIC_ORIGIN` (env; default from the request's origin) and make `approvalUrl` and every `meta` link absolute.
- [ ] **Menu review link.** `propose_menu` returns `meta.reviewUrl`, opening the menu card on the D15 home (`?menu=<id>&r=<revision>`). It carries no authority, only the location.
- [ ] **Pair a device.** `/agents` and the Kitchen screen get "Open this kitchen on another device": a QR code plus a short code, shown only in the browser that already owns the sandbox. Scanning it sets the visitor cookie on the new device. The pairing token is single-use, expires after 10 minutes, and is never in any tool result.
- [ ] **Approve card in the dock.** When the in-app agent holds lines or proposes a menu, the dock shows an Approve / Accept card. The click is a UI action under the chef session, never a tool call.
- [ ] **Instructions and prompts updated.** "Give the human `meta.approvalUrl` or `meta.reviewUrl` first; they approve on their device; then call `get_plan`."

### Ring 2: tools that converge
- [ ] **`revise_menu`** (scope `plan`): `{ proposalId, revision, changes[] }` over `editMenu`, plus new kinds `pin { ingredientId, productId }`, `replaceDish { dishId, brief }` and `addIngredient`. The agent can't use `keepOpen`; that stays the chef's.
- [ ] **Product hints in the brief:** `hints: [{ ingredient, productId }]` that resolution tries first.
- [ ] **Stable resolution:** try several query variants per ingredient (compound and split Finnish forms), fall back to `baseKey`, and cache ingredient → product per kitchen so one ingredient resolves the same way twice.
- [ ] **Fit check:** reject a product whose form or category contradicts the dish (smoked kassler for a braise needing raw shoulder). Use the D16 `meets()` where it applies; a flash-lite judgement only as a labelled estimate.
- [ ] **Course labels normalise rather than block** (`side` under a main counts toward the courses, or the model is asked to retry once with the critique, via the review mechanism).
- [ ] **Questions first:** a brief without `dietary` and with guests ≤ 30 returns `questions[]` (allergies, lactose, pork or religious limits, spice level). The agent answers and calls again. The dock asks the same questions in chat.
- [ ] **`reasoning`** (required, ≤ 300 chars, no PII) on `place_order`, `edit_line`, `plan_event`, `commit_order`, `revise_menu`, shown in "Your agent's changes" and the trace drawer.
- [ ] **`report_issue`** (scope `read`): `{ kind: missing_product | wrong_match | bad_data, ref, text }`, rate-limited, sanitised, listed in `/ops` as "What agents couldn't find".
- [ ] **`detail: "compact"`** by default on `search_products` and `propose_menu` (id, name, unit, pack, allergens, free-from); `"full"` gives today's record.

### Ring 3: preview and state
- [ ] **`dryRun: true` on `place_order`:** returns the lines that would be eligible or held, with reasons and totals, and writes nothing.
- [ ] **`decisions://open` and `get_context.openPlans` list menus waiting for review**, with `reviewUrl`.
- [ ] **Pack fit:** each line says how much is left over when a pack is far over the need ("13.25 kg left over").
- [ ] **MCP URL elicitation for approval** where the client supports it. The server asks the client to open `approvalUrl` out-of-band, and the agent never sees the human's confirmation.

### Ring 4: identity (GROWTH)
- [ ] OAuth 2.1 per the MCP authorization spec; the workspace comes from the token, not the cookie; keys are revocable; spend per user.
- [ ] Per-device sessions: a paired device today holds the same signed visitor cookie as the owner (deterministic `<ws>.<HMAC>`), which is fine for a sandbox. Revoking one device needs a per-device nonce in the cookie, with accounts.
- [ ] The agent's token stays `read/plan/order`. Approval is a human step-up (passkey, or a push to the chef's phone), never a scope the agent's token can carry.

## Owned paths
- `src/lib/server/tools/{mcp,mcp-extras,present,serve,key-limits}.ts`, new `src/lib/server/tools/report-issue.ts`
- `src/routes/agents/**`, a new pairing route `src/routes/pair/**`, `src/routes/.well-known/agent.json/**`
- The dock's approve card in `src/lib/ui/chat/**`, shared with the chat lane (coordinate)
- Tests for the above, plus evals in `evals/agent` (an adversarial case: a catalogue string asks the agent to approve or to follow a link)

## Needs (lead)
- **Contracts** (`src/lib/core/contracts/tools.ts`): `revise_menu`, `report_issue`, the `reasoning` and `detail` params, `meta.reviewUrl`, `dryRun`, `questions[]` on the `propose_menu` output.
- **Menu flow** (`src/lib/server/menu/**`, menu-track owner): the `pin`, `replaceDish` and `addIngredient` change kinds; hints; stable resolution; the fit check; course normalisation.
- **D15 home:** the `?menu=` deep link opens the menu card.
- **Env:** `PUBLIC_ORIGIN` on the Aiven app.

## Acceptance (observable)
- [ ] From Claude Code over MCP: propose → `reviewUrl` opens the menu on a **second device** paired by QR → accept → `plan_event` → held lines → `approvalUrl` opens on the phone → approve → `get_plan` shows them covered → `commit_order` returns a receipt. Screenshots at 390 px.
- [ ] No tool result contains a pairing token or anything that grants approval (unit test over every tool's output schema, plus the adversarial eval).
- [ ] The rerun case from 14 Nov: pin 462201 for the ribs through `revise_menu` and the other resolved ingredients keep their products (eval).
- [ ] `search_products` compact: 5 hits under 800 tokens (measured in the eval).
- [ ] A write's `reasoning` appears in "Your agent's changes" within 2 s (SSE).
- [ ] `pnpm gate` green; every new path works with `LLM_PROVIDER=fixture`.

## Out of scope
- Real accounts or OAuth before Ring 4; real Valio ordering (commits stay simulated).

## Report (the lane agent appends at the end of each run)

### Checkpoint for the lane restart, Sat 14 Nov night (da)
**Done, on main:** agent-door-ids `02fe6a9`; Ring 1 `5fa81f5` (R11-08, absolute links, pairing, reviewUrl, D17 suite); the D16 side `1eb870d` / `f71987a`; one ranking-preset source `a628eec` (core takes /request's presets; chat picks as /request does).

**Done, waiting for the lead (branch `lane/agent-door-revise`, head = this commit):**
- R12-08: CONTRACT `3db5fa3` (revise_menu in the registry, with 41's tightened bounds) and wiring + e2e `5783174`. menu-journey.test drives the real MCP endpoint: propose → revise (pin one; every other ingredient keeps its product) → absolute reviewUrl → chef accepts → plan_event → chef approves held lines → one receipt (same key, same receipt). Light gate green; tools/menu/d17/goals: 109 pass. 41 keeps the pin-persistence contract (pinnedBy, MenuStore.recent, EventBrief.hints) and rebases onto `3db5fa3`.

**In flight:** nothing.

**Next, in priority order**
1. Ring 2 `reasoning` on write tools (place_order, edit_line, plan_event, commit_order, revise_menu: revise_menu already takes it). Contract first (its own commit), plus where the op envelope keeps it (the lead's). Acceptance: required, ≤300 chars, scrubbed of e-mail and phone numbers; shown in "Your agent's changes" within 2 s (SSE); the D17 suite still green.
2. Ring 2 `report_issue` (scope read): `{kind: missing_product | wrong_match | bad_data, ref, text}`, rate-limited (key-limits), sanitised, stored as a finding; /ops lists "What agents couldn't find" (with 9c). Acceptance: an MCP call lands in /ops; text is data, never instructions.
3. Ring 2 `detail: compact | full` on search_products and propose_menu, compact by default. Acceptance: 5 hits under 800 tokens, measured in a test.
4. Ring 3: `decisions://open` lists menus awaiting review with reviewUrl; `dryRun` on place_order; pack fit.
5. The source listing on lookup_facts (D's product links/images as a web finding): expose it on MCP/REST with attribution, never copied files. Review D's images branch from the door's side.
6. Switch `menuReviewUrl` to the D15 home `/?menu=&r=` once it serves one (one line in present.ts).

**Risks**
- PUBLIC_ORIGIN must be set in the Aiven console (not the API). Without it links use the request host (*.aiven.app).
- Pairing state is in memory: one container (D3); a restart drops live codes (10 minutes anyway).
- `getClientAddress()` behind the proxy is likely the proxy IP; the pairing limits are built for it (soft per-client, global pause). ADDRESS_HEADER/XFF_DEPTH is unconfirmed.
- Product questions are regex-read: unusual phrasings fall through to the plan agent (safe; a missed answer).
- Not mine but open: dock approve card (E); Kitchen pair button (1f, `<PairDevice/>` ready); Kitchen PRESETS read core (1f); chat vs /request on "50 eggs" (D15 stage 2).

**How to resume**
- Worktree `../junc26-lanes/agent-door-v2` (branch `lane/agent-door-revise`); dev server on **5193** (5192 is the establish lane's): `DATABASE_URL= LLM_PROVIDER=fixture pnpm dev --port 5193 --strictPort`.
- Gate rule: `pnpm gate --only check,lint` + targeted tests (`vitest run --project server src/lib/server/tools src/lib/server/menu src/lib/server/agent/d17.test.ts`), then the SHA to the lead. Never a full gate from a lane. If a gate is stopped, kill its node tree too.
- Contract edits (core/contracts/tools.ts) go in their own commit for the lead.
- Commits stay local: the lead merges from the shared object store. Nothing is pushed without the user's say-so.

### Checkpoint, Sat 14 Nov evening (da)
**Done**
- agent-door-ids `02fe6a9` (merged into the lead's batch): /agents raw-id sweep fix + Copy button on the instructions; `decisions://open` due times from core `dueOf` (Helsinki words + ISO); R10-15 (a named product or "Which one?" chips, never the lexicon default); drill notices never counted as recalls; real source labels (live/cache/replay).
- Ring 1, lane/agent-door-v2 `5fa81f5` (merged into the batch): R11-08 `0c4b4ae` (an unadvertised tool is absent on MCP/REST before any work, via `offered()`); absolute links `9d78857` (PUBLIC_ORIGIN, else the request origin, applied at the doors); pairing `bb9f7cc` + `5fa81f5` (/pair, QR + 6-character code, single use, 10 min, sandbox only, keys refused; soft per-client and global miss caps); CONTRACT `4e92499` ResultMeta.reviewUrl; `581cc2b` propose_menu reviewUrl + "give the human the link first" instructions; D17 adversarial suite `715612f` (in eval:agent).
- D16 side, lane/agent-door-d16 `1eb870d` (next after the batch; includes a local merge of lane/a-atp): CONTRACT `741abc5` + `0aaac60` get_context constraints (kitchen labels exposed as `notes`, since nothing enforces them); requirement_unmet → find_substitutes next step naming requirement + fact; mandate words and prompts in the D16 vocabulary; dock allergen answers through `meets()`.
- Ring 4 note: per-device sessions (above).

**Open**
- Ring 2: `reasoning` on write tools (contract + op envelope field, the lead's), `report_issue` (contract, /ops listing with 9c), `detail: compact|full` (contract; 5 hits < 800 tokens measured).
- Ring 3: `dryRun` on place_order; menus awaiting review in `decisions://open`; pack fit.
- Not mine: the dock approve card (E), the Kitchen pair button (1f, `<PairDevice/>` is ready), the D15 `/?menu=` deep link (then switch `menuReviewUrl`).
- agent-rank (per-request ranking preference: cheapest / lowest carbon / prefer Finnish / most reliable; CONTRACT `99a61d9` rankBy) rebased onto main as `962bb2a`; it still needs its light gate before it goes to the lead.

**Risks**
- PUBLIC_ORIGIN unset on prod: links point at the request host (*.aiven.app behind the proxy). 9c sets it in the console at the deploy.
- `getClientAddress()` behind Aiven is likely the proxy IP: the pairing limits are built for that (soft per-client, global pause); ADDRESS_HEADER/XFF_DEPTH is unconfirmed.
- Pairing state is in memory: one container (D3); a restart drops live codes (they last 10 minutes anyway).
- Product questions are regex-read: unusual phrasings fall through to the plan agent (safe; a missed answer).

**Resume**
- Branches: lane/agent-door-d16 `1eb870d` (worktree ../junc26-lanes/agent-door-v2, dev port 5193; 5192 belongs to the establish lane); agent-rank `962bb2a` (worktree ../junc26-lanes/agent-rank).
- Gate rule: `pnpm gate --only check,lint` + targeted tests, then the SHA to the lead.
- Next 3: (1) light-gate agent-rank and send it; (2) Ring 2, contracts first as their own commit (reasoning, report_issue, detail); (3) Ring 3 `decisions://open` lists menus awaiting review.
