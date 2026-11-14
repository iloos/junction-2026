# Round 11 handoff: preserve intent and make recovery truthful

14 November 2026. Source/probes through `bfd2c0f`; final verification `b2dfe9c` (documentation only since those probes), 588 source/config hashes and zero broken report links. Rendered production-build copy made during `79d2029` (`commit:unknown`). [Full review](../review/ROUND11-ADVERSARIAL.md) · [local evidence and commands](../../scratch/round11/README.md). Review only; no app source edits or production operations. **Four new P1 findings and ten new P2 findings**, plus earlier open cases.

## Release priorities

| Owner | Concrete failure | Required acceptance |
|---|---|---|
| **B/E + core** | **R11-01:** rules path asks for 250 ml of a 1 l milk, buys 250 ST = 250 l. Unsupported `ml` becomes `sales`. | Normalise common units; explicit unknown units clarify before purchase. Check joined units and multipacks at every entry. |
| **B/core, D16** | **R11-02 + R10-03:** “4 packs lactose-free milk” loses its requirement and buys ordinary milk after substitution; arbitrary reviewed menus also lose dietary intent. | Requirements survive every unit and menu/need/line/edit/replacement path. Seeded vegetarian stopgap `36c3d60` covers only its named seeds. |
| **B/E/lead** | **R11-03:** Request commits autonomous lines, chef approves the rest, then Request replays the first receipt because its key contains only plan/version. | One command-identity rule across Request, Chat, loop and Kitchen: exact lines + accepted terms; retries replay, a newly authorised remainder gets a new command. |
| **E/core/lead** | **R10-02b:** cancellation after the re-read but before purchase still buys. Task stays cancelled; final text says “Ordered”. | Durable ownership/cancellation at the effect boundary. A pre-call read alone still races. |
| **Core** | **R10-04/05:** replacement + amount edit can buy both original and replacement; direct-unit contention adds full demand instead of residual. | Amend one active strategy, preserve split/recipe ratios, compute typed residuals, verify actual purchased quantities. |
| **Agent-door** | **R10-15:** a named brand/variant question still answers for the generic default product. | Resolve exact identity or ask which product before origin/allergen/recall answers. |
| **1f** | **R11-14:** at 390 × 844 the decision rail pushes the composer to y=1121.75; a normal click fails. | Definite mobile height and bounded decision/history scrollers; composer reachable with details and virtual keyboard. A temporary `height:75dvh` in the browser restored it to y=795.25 and made it clickable. |

## Next batch

- **Core:** saved purchase/plan retries still fetch supplier data before idempotency replay (R11-04). Zero → positive direct-need edit keeps its purchase at zero (R11-05). Partial recipe receipts still overstate confirmed cover (R10-06).
- **9c/1f:** gap reads must not advance past missing events on a transient failure or incomplete page (R11-06). UI startup ignores the first poll's events; recalls, resets, selected rooms and another Kitchen tab are not fully invalidated (R11-07).
- **Agent-door:** an MCP call to hidden `read_image` executes the handler, then answers “not found” (R11-08). Share availability policy for listing **and calling**; no paid call was made in this probe.
- **B/core:** price ranking compares pack prices when comparison prices are absent (R11-09); base-name suffix matching labels material changes as “another pack” (R11-10).
- **9c/core:** Ops calls a dietary refusal “out of stock at Valio” (R11-11) and replays the whole log once per plan (R11-12; 100 plans/1,200 ops measured 1.8–2.9 s locally).
- **91/D:** sponsor smoke accepts Gemini `idle` without a successful live answer (R11-13). Tie evidence to the exercised job/workspace. R8 durable web write/queue defects remain open. Menu null envelope still returns 500; Chat null now returns 400.

## Evidence and limits

- **17 focused observation/diagnostic checks passed across final runs:** 8 real-handler domain cases, 7 pure cases, 1 counted-handler MCP case, 1 performance diagnostic. These passes reproduce defects; invert into desired-behaviour regressions when fixing. The mobile pointer/layout check is separate browser evidence.
- **Committed R10 suite, `ADV_SHOW=1`: 5 passed / 8 failed**, 12.34 s. Failures: late cancel, menu constraint, replacement edit, contention residual, partial recipe confirmation, calendar DTSTART, named-product question and raw transport ordering. The last test predates `/api/events`' new ordering wrapper; update it to exercise that layer. R11 separately probes the wrapper's transient-error loss.
- **Committed local browser suite: 8 passed / 3 failed / 12 opt-in skips**, 10.6 min. Failures: `/agents` wording, mobile out-of-viewport interaction, intermittent approval-link plan lookup. The exact approval-link rerun passed in 5.6 s; preserve the original failure. Idle and full visitor isolation passed. Production-only live-service smoke was excluded.
- **16 captures** at 1440/390: no horizontal document overflow, unnamed visible buttons or page exceptions. Mobile vertical containment failed despite those clean metrics. Own `pnpm check`: zero errors/warnings. Lead's observed gate had 908 unit passes, **11 expected failures**, six TODOs; those open cases are not guarantees.
- Rendered Impeccable scan failed with a protocol error; six source warnings are intentional grouping borders. Technical audit 10/20, limited. No full contrast/screen-reader/physical-touch check.
- Production HTTPS was unreachable here; no live sponsor/production/Postgres race claim. Later profile/event/UI merges need a fresh pinned rendered pass. Final source hashes and build-copy hash are in the evidence ledger.

## Integration guidance

Keep D15's staged landing, with working deep links, task resume and standalone Request until the new entry passes. D16 should compile hard intent before product resolution, preserve it through all amendments, and return a shared `ok/unknown/no` decision. Do not solve each new symptom with another entry-specific guard.

Use **entry × actor × unit × requirement × amendment × fault × recovery** cases. Assert purchased SKU/amount/authority, receipt identity and remaining need. Then pin source/deployed SHA and update CLAIMS/PITCH/site from that same build. Source, screenshots and a green expected-failure suite are different evidence boundaries.

For the new D17 agent-door brief: pairing needs atomic single use, expiry/revocation and concurrent replay tests; no pairing authority in tool outputs/logs. Pin the canonical public origin. Keep location links harmless on automatic traversal and grants bound to the human's rendered terms.
