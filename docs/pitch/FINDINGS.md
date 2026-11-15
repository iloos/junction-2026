# FINDINGS (S7, running list)

_S7, the pitch lane, keeps this list of what turns up while mapping and sends each batch to the lead (junc26-52), who routes it. One line each: what · where · severity · suggested owner. Status: open, sent or done._

## Secrets and the public scrub
- Valio API key and the Context.dev, Exa and Modal redeem codes: the working tree has been redacted since `d332715` (Sat 01:30); the values remain in history from `b526a62`, which is on origin. The history rewrite (filter-repo) is still needed before the repo goes public · `docs/event/challenges/**` · P1 · lead/user · sent
- Two sponsor promo codes are still in clear text: Cala's (`main/cala--*.md:74`) and atech's (`tech/*atech*.md:101`). They are public event codes, low risk, but they belong in the same scrub · `docs/event/challenges/` · P3 · lead · sent
- No secrets in other docs: the only key-shaped strings are judge-key format placeholders (`jk_<ws>.<exp>.<hmac>`, `jk_ws-j-0e74…` in design mocks) · P3 · none · sent

## Stale docs
- `concept/SYSTEM-MAP.md` (written at `b10cd43`) lists D15, D16 `meets()` and D18 `commandKey` as planned, but they are on main (`core/mandate/meets.ts`, `core/command.ts`). It predates ring 6 (room, own kitchens, Forecast, compare panel, photos) · P2 · S7 · done (archived)

- `CLAIMS.md`: outside keys now see 17 tools (20 registered, minus approve, set_mandate and read_image), not 15. Rows also cite `/agents/chat` as a page, but it now opens the dock over the Kitchen · P2 · S5 · sent
- `PITCH.md` "Not yet claimable: new events from chat" no longer holds: the hero journey plans a new event from the dock · P3 · S7 · done in PITCH rewrite
- `SUBMISSION.md` Gemini section: "tool calls chosen by a deterministic scripted planner" needs a re-check against the current chat path; no mention of the room, own kitchens, Forecast or compare · P2 · S5 (with S3) · sent

## Hygiene (no deletions by S7)
- 30 worktrees registered. Branches merged into main whose worktrees still exist: agent-door-ids, agent-rank, lane/agent-door-revise, lane/brand-logo, lane/c3-basket, lane/c3-calendar-events, lane/c3-establishment, lane/d2-sponsors, lane/docs-clean, lane/e2-chat, lane/g17, lane/history-profiles, lane/independent-fixes, lane/menu-v2, lane/o-obs, lane/u-usual, worktree-agent-af854a52ab1c59a0b. Three detached worktrees (agent2-gate, d29-check, request-gate). Candidates for `git worktree remove` once their sessions are idle · P3 · lead · open
- Merged branches with no worktree (safe `git branch -d`): agent-door-hardening, agent-questions, core-superseded, lane/a-valio-live, lane/a4-core, lane/agent-door-d16, lane/agent-door-v2, lane/c3-daypicker, lane/facets-eval, lane/g4–g8, lane/g11–g16, lane/kitchen-profiles, lane/no-covers · P3 · lead · open
- Unmerged, probably dead: agent-r10, core-r0e, fix-rescue-loop, lane/core-db, lane/g2, lane/g9, lane/g10. Check before deleting · P3 · lead · open
- Repo root: `certs/` (aiven-ca.pem) and `.pnpm-store/` are untracked and not in `.gitignore`. `git status` stays clean only because of an ignore elsewhere; add both to `.gitignore` explicitly. `.agents/` (21 vendor skill files) and `skills-lock.json` are tracked; decide whether they ship in the public repo · P3 · lead · open
- Valio redaction commit says the values live in `Misc/` (gitignored, untracked): fine for the repo, but don't copy `Misc/` into the public squash · P3 · lead · open
