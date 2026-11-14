# Adversarial handoff: purchasing transitions before expansion

14 November 2026. Source archived at `cbca3a7`; checkout moved from `152e413` during the review. Read-only application review; no source edits, branch changes, commits, provider calls or production writes. Full evidence and correction shapes: [Round 9](../review/ROUND9-ADVERSARIAL.md).

## Lead decisions needed

1. **Treat task transitions as a release gate.** Ten new probes reproduced ten defects. The highest-value E/core batch is continuation identity, terminal-state enforcement, physical-amount amendment and a task projection over every active purchase. Avoid landing these as independent display fixes.
2. **Keep semantic purchasing defects ahead of the hero expansion.** Reproduced earlier findings still allow a lactose-free request to buy ordinary milk; replacement can buy original plus substitute; supply risk can change after grant; doubling porridge leaves milk unchanged. “The trust core holds under every review” is too broad for this evidence.
3. **Finish adopting call scope and durable web work.** The new helper and text caps are useful. At the archived SHA the helper had no call sites, Chat used raw handlers, and `onCurrentRun` could retain an old run even when the new run was known. Web acceptance still swallows write failure; a database claim can do no work if missing from the local map.

## Concrete new failures and owners

| ID | Priority | Reproduction result | Owner |
|---|---|---|---|
| R9-01 | P1 | Continue commits eligible subset; after a later grant, the same plan-version key replays that first receipt forever. | E + core |
| R9-02 | P1 | Cancel → grant → stale Continue creates an order; task remains cancelled. | E |
| R9-03 | P1 | “Make it 20 kg” on a 4 l need becomes a 20 l purchase; demand stays 4 l. | E + core |
| R9-04 | P1 | Two-plan task says done with another plan held; continuing ignores the second plan. | E |
| R9-05 | P2 | One granted reason group is committable, but another pending group prevents Continue from acting. | E + core |
| R9-06 | P2 | Monday-only kitchen can commit a Thursday delivery; calendar is a Request note. | core + B |
| R9-07 | P2 | One Valio adapter admits 12 concurrent calls despite the four-call claim. | catalogue/core |
| R9-08 | P1 | Known new run + old context → normalization returns old run. Refines Ring 3 M2. | 9c + lead |
| R9-09 | P1 | A referenced event waits for SQL; a later inline event overtakes it; the SSE high-water filter drops the earlier event. | 9c |
| R9-10 | P2 | Character-count sizing sends Unicode beyond the notification byte limit; detached publish has no rejection handler. | 9c + lead |

Additional source findings: Request `t-…` tasks still fail Chat's `task-…` parser; model action schema is dropped at the adapter; final image omits the file-loaded Decisions replay book; replay fit is labelled Gemini; MCP marks commitment non-destructive. These have exact locations and acceptance checks in the full report.

## Suggested integration order

1. **E/core/lead:** persist task and command identity before effects; terminal states; compatible physical amount amendments; all active plans; Request-to-Chat ID parity. Prove mixed eligible/held subsets, partial grants, a second item, cancellation, reconnect and retry against durable rows.
2. **Core/B/E:** carry hard requirements into the need; supersede purchase strategies; update the entire recipe dependency closure; handle material supply drift. Prove request → substitute → edit → approval → commit.
3. **Lead/9c/D:** refreshed context at every door; run fence; reliable web acceptance and DB work payloads; final-image replay and offline check.
4. **1f/9c/91:** show the same remaining work, decision and receipt across Kitchen, Chat and Ops; rehearse and update claims against a pinned deployed SHA.

Wave 2 memory/forecast should wait for these. A single reproducible journey with failure/recovery proves more than another surface.

## Verification and improvements

The seven-step gate passed: type check, lint, eval self-tests, build, 618 unit tests (39 skipped), eval and agent eval. Ten new observation probes passed by reproducing defects (eight domain/runtime, two mocked event-transport probes). Eighteen previous probes were rerun; they contain both working counterexamples and still-open observations. Updated assertions record improvements: physical demand now survives Request, awaiting-supplier outcome stays unconfirmed, mixed units stay separate, and the porridge formula is clearer.

Twelve local Chromium captures at 1440/390 px showed no document overflow or browser exceptions in the observed states. The buffet and milk draft/handoff worked. Raw IDs still leak outside System; replay is shown as Gemini. Complete keyboard/touch, production races, live provider calls and the full e2e gate were not run. The text-cap router landed during this review; its current targeted check is recorded in [scratch/round9/README.md](../../scratch/round9/README.md).
