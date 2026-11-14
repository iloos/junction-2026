---
name: playtest
description: Playtest a deploy (or the local fixture build) as a first-time visitor, judge the run against six rubrics, and write routed findings with a diff against the previous run. Use after every deploy, when asked to "playtest", "judge the build", "what's broken on prod", or by a lane checking its own surface.
---

# Playtest: run the journeys, judge them, route the findings

One loop, about 15 minutes: **record → judge → verify → FINDINGS.md → diff → route**. The recorder decides nothing; the judges do, and you check what they claim before it is a finding.

## 1. Record (≈5 min)
- A deploy: `KITCHEN_URL=https://app.mandate.kitchen node evals/playtest/run.mjs` from your worktree.
- Local: `node evals/playtest/run.mjs` (builds and previews on 5190 with `DATABASE_URL=` blank and the fixture LLM).
- Only some journeys: add `--grep "m1|j3"`. One viewport: `--project d1440` or `--project m390`.
- Output: `scratch/playtest/<UTC>-<target>-<commit>/` with `RUN.md` (steps per journey, where the visitor got stuck, the diff of stuck steps against the previous run), and per `<viewport>/<journey>/`: numbered beats (`.png` full page, `.fold.png` first screen, `.txt` DOM text), `journey.json` (steps, chat turns, request ids, receipts, notes), `console.txt`.
- Journeys (`evals/playtest/journeys.play.ts`): m1 shortage re-plan, m2 words → costed plan, m3 outside agent stopped, m4 Valio's view; j1–j9 the Round 12 matrix (kitchen as basket, request, chat, diet, usual order, product card, ops, outside agent, public site); d23 one ask through both doors gives one basket; r1 the room (D24): three stores order, Ops shows them. **r1 writes to the shared room `ws-judges`** (stores named "Playtest …", milk orders only after a store is created); skip it with `--grep-invert r1` when the room is in front of judges. Live models are called on a deploy: m2, j2, j3, j4 make roughly 15 Gemini calls in all, inside the caps.

## 2. Judge (≈7 min, parallel)
Spawn **six judge subagents in one message** (general-purpose), one per rubric in [rubrics.md](rubrics.md). Each gets: the run directory path, its rubric verbatim, the owner map below, and this instruction: *argue the position given; read the `.fold.png` and `.png` beats with the Read tool and the `.txt` files; every finding names the beat file that shows it; return JSON only*:
```json
[{"key":"<stable-kebab-slug, same defect = same key across runs>","rubric":"<name>","severity":"P0|P1|P2|P3","owner":"S1|S2|S3|S4|S5","surface":"kitchen|dock|request|ops|agents|site|tools","title":"<one sentence>","repro":"<journey/viewport/step + beat file>","evidence":"<quoted text or what the image shows>","fix":"<one line>"}]
```
Severity: P0 wrong purchase or a mandate bypass; P1 a judge can't complete a north-star moment or is told something false; P2 slows or confuses (five-second rule broken, a stuck step with a way round); P3 polish.

## 3. Verify (≈2 min)
Before writing anything down, open the cited beat for every P0/P1 and a sample of the rest. Drop a finding whose beat doesn't show it; a stuck step can be the harness's selector, not the app (check the screenshot: is the control there under other words? Then it's a harness fix in `journeys.play.ts`, not a finding, unless the words broke VOCABULARY). Merge duplicates across judges under one key.

## 4. Write and diff
- `FINDINGS.md` in the run directory: a table by severity (key · owner · title · repro · fix), then one section per owner S1–S5 listing their findings. `findings.json` beside it (the verified list).
- Diff with the previous run's `findings.json` by `key`: **fixed** (gone), **new**, **still open**, **regressed** (fixed before, back now). Put the diff at the top of FINDINGS.md.

## 5. Route
- Send each owner its own section (SendMessage to the lane session, or to the lead when unsure who holds it). The lead gets the whole summary: counts by severity and owner, the diff, and the run path.
- A finding confirmed twice becomes a test under `evals/` (the owner's suite, or `evals/ui` for UI) so it can't silently come back.

## Owner map
- **S1** core, tools, MCP, `/agents`, the mandate gate, the shortage backend.
- **S2** Kitchen, basket, the dock shell, `src/lib/ui/**`, DESIGN.md.
- **S3** chat replies, `/request`, menus, readings of words.
- **S4** Ops, the event bus, deploys.
- **S5** the site, CLAIMS, PITCH, the playtest harness itself.

## Traps
- Never run the local preview against the worktree `.env` (prod database): `run.mjs` blanks it; don't start your own preview without `DATABASE_URL=`.
- The harness's selectors are visible words. A copy change can strand a step: fix `journeys.play.ts` in the same pass and say so in RUN.md's diff, so "newly stuck" isn't misread as a regression.
- Sandboxes are per browser context: each journey starts fresh. m3's judge key is per sandbox too.
