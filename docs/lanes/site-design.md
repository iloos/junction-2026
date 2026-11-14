# Lane: site-design (mandate.kitchen look, /story, the /how map)

Branch `lane/site-design`, worktree `../junc26-lanes/site-design`, always fast-forwarded from `lane/site`. Owned `site/public/site.css`, `site/public/story/index.html`, `site/public/how/map.{js,css}`. d0 owns the rest of `site/` and is the only deployer; 91 checks every claim. **From the next ring d0 absorbs site design**; this file is the handover.

## Done (Sat 14 Nov), all live on mandate.kitchen
- **One token system, two themes** (`4e4675e`, `70e113d`, `fc64e8a`): `site.css` `data-theme="dark"` (near-black navy, paper L 0.155); landing and `/proof` pinned light, `/story` and `/how` dark; the system-dark media block applies only to pages with no `data-theme`. Serif only via `.said` (a person's quoted words: the chef's mandate).
- **/story** (`d4ec131` → `3e1d41a`): nine sections, one rhythm each (heading, one-line lede, one visual, footnote), hairline separators, no snap or counter, side dots ≥1100px.
  - Hero: user's line "What do you need? We'll sort it out." + dim "That's a **mandate**." (`511b8a5`, accent `cb2e67d`; mirrored on the landing by d0).
  - Ask → plan → decision bound to `cases.json → plan` (`1a5151a`); reply shown as a labelled verbatim excerpt (`0b44e67`).
  - Checks walkthrough: click-to-play, not scroll-pinned (`a64cad1`); ticks only where the recording backs a pass.
  - Out of stock: verb · before → after · chip + one short reason, on one column grid (`26bc20d`, `ac4cd6a`; 91 set the in-house reason).
  - Readable product names via the shared `/name.js`, mono only for quantity chips (`51defe0`).
  - Titles follow the VOCABULARY "Voice" rule.
- **/how system map** (`06c550e`, `44cd65e`, `4745a4c`, `b39f818`): five clickable zones (four doors, gate, pure rules, store, partners); a clicked zone pins until closed; the recorded ham line traced need → receipt on scroll (91's sizing sentence verbatim); statuses "seen live"/"tested" with a Proof link instead of test paths.
- **Content source:** `Junc26/scratch/site-review/SYSTEM-MAP.md` (gitignored; checked against code at `b10cd43`). Screenshot scripts: `Junc26/scratch/site-review/{story2,checks,map,theme}.mjs`.

## In flight
- Nothing of mine. d0's agent is reworking the `/how` flows tabs (stage strip, one recorded case per tab, no code paths).

## Next (for d0)
- Look at `/story` on Safari/iOS: the `/how` map's sticky trace stage and `svh` units; the side dots.
- The plan slide's three panes differ in height; consider aligning the footers or trimming the plan pane further if the recording grows.
- `/how` rules columns and callout: the user's "too dense, multi-font, greyed" note applies to any remaining mono or grey second lines.
- If the recorder renames case ids or reorders steps, update `RUN` (the `why`/`line` step indexes) in `story/index.html` and the map's trace bindings.

## Risks
- Bindings read `cases.json` by id and step index; a re-record can silently fall back to the static text (the page stays truthful but stale).
- The checks stop mapping (which check stops which case) is editorial, cleared by 91 on Sat 14 Nov; re-check after any re-record.
- The plan reply is an excerpt to its first full stop; a re-record with a different first sentence changes what is shown (91 accepted excerpting over re-recording).

## How to resume
- `git -C ../junc26-lanes/site-design merge --ff-only lane/site`, edit, commit, send d0 the SHA; d0 merges, 91 checks, d0 deploys.
- Preview: `python -m http.server 4618 --bind 127.0.0.1` from `site/public`, then `node scratch/site-review/story2.mjs` from `Junc26` (Playwright).
