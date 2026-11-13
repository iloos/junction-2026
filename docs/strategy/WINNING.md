# How we win

## Our principles (from the team)
1. **Impressive UI/UX.**
2. **Robust, flexible data.** Lots of data points; we stress-test both performance and the UI.
3. **Solves a real problem.**
4. **Explains itself.** Every extra word we say should trigger "wow", "who would have thought", "no way, that too?". Guide what they see with context, but don't explain the app.
5. **A real working app, not production-ready.** Conveying an achievable concept beats being technically complete, *but* technical impressiveness, creativity and good sponsor use count a lot.
6. Local storage over a database; a proper but light API structure.

## Mapped to how we're actually judged
| Stage | Who | What wins there | Our lever |
|---|---|---|---|
| Peer review (Sun 10:30–14:00) | Tired hackers, ~2–3 min per table | Instant hook, something to touch, a visible wow in the first 30s | A live URL plus a QR code on a card; the demo opens straight on the money shot (no login, no empty state); seeded data |
| Partner judging | Challenge partner | Their criteria, use of their data/tool | Read the brief verbatim; ask the mentor Friday night; their API used in the hero flow |
| Tech prizes | Verda / Modal / Exa / Context.dev | Load-bearing, visible use | Each one powers a named moment in the demo |
| Top-5 pitch | 7 judges, 4 founders/VCs | Problem worth solving, why agents fail, path to scale | 3:00 script below; failure-mode honesty; who pays |

## The "wow" ladder (design the demo around it)
1. **0–10s, the hook.** One sentence of problem plus the screen already showing something beautiful and dense (thousands of points, a living graph).
2. **10–40s, it works on real data.** Type or say one thing and the agent visibly *does* something: it transforms the data, the graph re-lays out, a panel fills in. Its trace is visible.
3. **40–90s, "who would have thought".** A non-obvious insight only the data and graph reveal (a hidden path, a change over time, an outlier).
4. **90s+, "no way, that too?"**: stacked surprises, each costing one sentence:
   - scale it 10× live (slider: 10k → 1M points, still smooth);
   - Claude/ChatGPT drives our app through our **MCP server**;
   - Modal fans out 200 jobs live;
   - it works offline / reloads with state intact;
   - export, share link, time travel.

## Pitch skeleton (3:00 hard; the mic dies)
- 0:00–0:20 Problem with a real person and a number. One breath.
- 0:20–1:50 Live demo of the wow ladder, steps 1→3. The presenter drives the demo themselves with the single handheld mic in the other hand (the guidebook advises one person on stage). Rehearse driving one-handed. Hotkeys or a preset demo route help.
- 1:50–2:20 Why now / why hard: the insight competitors don't have; how agent failure is handled (guardrails, evals, human in control).
- 2:20–2:50 Impact plus business: who pays, the next 3 months, path to scale (Verda/Modal).
- 2:50–3:00 Closing line plus the name.
Q&A prep: "Why would X not just build this?", "What breaks it?", "What did you build vs. use?", "Business model?"

## The 2-minute video
Record a rough cut **Saturday ~22:00** and the final one at Sunday 06:00–08:00. Screen capture of the real product with voice-over and captions. The first 5s shows the wow, not a title card. Upload as unlisted early, then make it public.

## Anti-patterns
- An empty state on load. Explaining the architecture before the payoff. A login wall. Spinners longer than 2s on stage (use the fixture/hedge path). A claim that isn't wired. More than one thing to read on screen at once.
