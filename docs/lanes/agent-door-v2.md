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
-
