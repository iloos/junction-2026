# STATUS

_The lead rewrites this at each checkpoint. It is the "now": what works, what's next, what bites._

**Updated:** Sun 15 Nov 07:25, ring 6 (lead junc26-52). Lanes S1–S5 and S7: [handoff/ring6/SESSIONS.md](handoff/ring6/SESSIONS.md). Submission 10:00; the user keeps polishing UI/UX until ~09:15.

**Deployed:** https://app.mandate.kitchen and mandate-b run wave X `804b892`, tagged `demo-good-x` (the safety build; smoke 12/14 UI, the two fails are a timing flake and a dock fix in Y). The site https://mandate.kitchen is a Cloudflare Worker (lane/site, S5 deploys). Staging is powered off. Waves: Y cuts 07:40, Z ~08:30, a last one ~09:15; each runs the full gate → push → S4 deploys → the lead smokes.

**Works on prod:**
- **Hero journeys:** words → menu → plan → decisions → ordered → Ops; the Christmas buffet for 140 (21 lines, 3 alone, 15 in 3 decisions, 3 can't be ordered, €933.92) is the video's brief.
- **Kitchen:** per-line Accept · Reject (stays in place, struck through, with Undo, out of counts and budget) · Swap; one Accept all; the plan header says counts once; English product names (Valio Aimo's `nameEn`) as a muted second line (Y).
- **Chat:** readings and chips instead of "I could not" (X); chef wording and typos in search ("steaks", "cow meat", "oat milk for coffee"); D22 approval in the dock and over MCP elicitation.
- **Room:** own stores, "+ New store", leave the room; only the presenter resets a shared room (X).
- **Ops:** neutral dark tokens, one purpose line, per-store shortage outcome cards, clickable store tiles (Y); the admin-panel tables come in Z.
- **Speed:** one warm plan ~1.2–1.5 s, 5 at once p95 5.4 s (warm-ups deferred until a plan goes quiet; lookups stay on).
- **Gemini Decisions:** 202 live calls in 24 h (~0.34 s), replay 33, rules 144, all traced.

**Known open:** a dish-level diet ("a vegetarian main") read as menu-wide, and "plan it" stored as a diet answer (S3, Y); normal lunch briefs thin (matcher plurals, lohi → tench, menu model unstable; S1 + S3, Z); the model-led chat harness (D34, behind a flag); the shared room needs a reset by the user (presenter key) before the final take.

**Decisions tonight:** D22–D34. D33 parks scaling (Verda later). D34 moves the chat to a model-led harness with the rules guarding the order.

**Waiting on the user:** the room reset before the final take · whether to switch on `CHAT_HARNESS=llm` (~09:00) · rotating the judge and smoke keys and the history scrub before the repo goes public.

**Rules learned (keep):**
- The main checkout is lead-only; lanes work in `../junc26-lanes/<lane>`; stage exact paths; push only after `merge-gate: GREEN` (read the verdict line, not the exit code).
- Lanes run `pnpm gate --only check,lint` plus targeted tests; the lead's main gate is the only full gate.
- Dev servers and test previews with `DATABASE_URL=` blank (worktree `.env` points at prod).
- No session reads `.env` values or pastes keys into chats; presenter actions are done by the user in a browser.
- Aiven env updates via the API replace the whole list: env and secrets only through the console.
- A peer's permission-blocked action is never relayed (no laundering).
