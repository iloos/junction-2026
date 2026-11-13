---
name: vision-check
description: Compare what the pitch claims against what the code actually does, and report the gaps. Use every ~6 hours during the hackathon, before recording the video, before the pitch, or when someone asks "are we on track", "what's not wired", or "can we claim X".
---

# Vision check

Run an honest gap review between `docs/PITCH.md` / `docs/strategy/WINNING.md` and the running app.

1. Read `docs/PITCH.md` (demo beats and the claims → evidence table), `docs/PLAN.md` and `docs/OVERVIEW.md`.
2. For each demo beat and claim, find the evidence in code: the route, component or port adapter that makes it real. Prefer running it (dev server plus a Playwright screenshot, or a curl to the API route) over reading it. Classify each as:
   - **wired**: works end to end on demo data;
   - **fixture-only**: works only on the fixture/fake path (say so on stage, or wire it);
   - **missing**: not built.
3. Check the demo path for: an empty state on first load, any spinner over 2s, console errors, a secret in client code, the deploy URL serving the latest commit.
4. Write a timestamped snapshot to `docs/reviews/YYYY-MM-DD-HHMM.md` with a table (beat/claim · status · evidence · fix-or-cut), then a ranked list of the 3 highest-value fixes for the time remaining.
5. Update `docs/PITCH.md` statuses and `docs/OVERVIEW.md`; append one line to `docs/LOG.md`.

Be blunt. A claim we can't back gets cut from the pitch, not defended.
