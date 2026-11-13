---
name: vision-check
description: Compare what the pitch claims against what the code actually does, and report the gaps. Use every ~6 hours during the hackathon, before recording the video, before the pitch, or when someone asks "are we on track", "what's not wired", or "can we claim X".
---

# Vision check

An honest gap review between `docs/PITCH.md` / `docs/strategy/WINNING.md` and the running app.

1. Read `docs/PITCH.md` (demo beats and the claims → evidence table), `docs/PLAN.md` and `docs/STATUS.md`.
2. For each demo beat and claim, find the evidence: the route, component or adapter that makes it real. Prefer **running** it (a Playwright screenshot of the deployed URL, or a curl to the API route) over reading code. Classify each as:
   - **wired**: works end to end on demo data;
   - **fixture-only**: works only on the fixture path (say so on stage, or wire it);
   - **missing**: not built.
3. Check the demo path for: an empty state on first load, any spinner over 2s, console errors, a secret in client code, the deploy URL lagging `main`.
4. Write `docs/reviews/YYYY-MM-DD-HHMM.md`: a table (beat/claim · status · evidence · fix-or-cut), then the 3 highest-value fixes for the time left.
5. Update the statuses in `docs/PITCH.md`, and tell the lead what to put in STATUS.md.

Be blunt. A claim we can't back gets cut from the pitch, not defended.
