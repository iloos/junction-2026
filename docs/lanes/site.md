# Lane: site (mandate.kitchen)

Owns `site/` only: the static site on the Cloudflare Worker `mandate-landing`, separate from the app. The app itself is on Aiven at `app.mandate.kitchen` (see [foundations/deploy.md](../foundations/deploy.md) § Domains). Shared with session 73 (lane/site-design): 73 owns `site/public/site.css`, `/story` and `/how/map.{js,css}`; this lane owns the landing, `/how/index.html`, `/proof`, the recorder and `cases.json`, and merges and deploys. Claims are checked by 91 (junc26-2f) before every deploy.

## Checkpoint (Sat 14 Nov, late; handover for the lane restart)

This lane now also owns 73's site design (lane/site-design is merged; see [site-design.md](site-design.md) for 73's notes).

**Live on mandate.kitchen:** lane/site `dfff213`, recordings in `cases.json` (cases and chain on app `4752d00`, plan on `b10cd43`, sponsors on `ff7f6c3`). 91 cleared everything except `6f7e66e`/`1ebb91c` (the tagline) and `b0aae2c` (the flow tabs), which went out before 91's check; 91 has seen them since and raised only R12-11 below.

**Done since `d872470`:**
- Readable product names with mono only for quantities (`d99a24a`, `51defe0`); `name.js` ports the app's `readableName`.
- The Voice rule: no slogan titles (`9559e33`, `80d1b44`).
- Sponsor tiles from `/healthz`, plus a barcode-verified Valio Aimo listing (`9d4e9da`, `2c5da2b`).
- The user's tagline "What do you need? We'll sort it out. That's a mandate." on the landing and /story, with one recorded fact under it (`6f7e66e`, `1ebb91c`, `511b8a5`, `cb2e67d`).
- /how: code lines removed (`80f3d95`, `4745a4c`); flow tabs as four-stage strips with one recorded case each (`b0aae2c`); architecture diagram at the top (`d2e8b81`, `dfff213`).
- /story: click-to-play checks (`a64cad1`); out-of-stock reasons in place of the Why expanders (`26bc20d`, `3e1d41a`).
- Merged 73's handover (`fbffa1f`).

**In flight:** nothing; the worktree is clean.

**Next (in order):**
1. **R12-11, 91's site-truth list** (docs/review/ROUND12-ADVERSARIAL.md R12-11). Invariant: every number names the release it was recorded on, or says it's historical.
   - /proof line 107, "15 supplier confirmed and 3 awaiting": the split comes from the simulated supplier and changes on every run. Drop it ("18 lines on one order, one receipt; the supplier's confirmations are simulated"), or bind it to the recorder with commit and time.
   - The chain's "may order alone up to €400 a line": the k-lounas seed is €400 (lineCap 40000), but the review saw the hotel's €800 exercised. Make `recordChain` capture the plan's kitchenId and that kitchen's mandate from the snapshot, and render the € from it. If the plan ran in the hotel, rerun it in k-lounas.
   - Every recorded number (chain counts, plan, sponsors, case cards) shows "Recorded on <commit>, <day time>" from `appCommit` + `recordedAt`. Cards from older releases keep their own commit.
   - Built, live and next statements on /proof and /how: a CLAIMS row marked "say it, tests" or "not yet" must not read as seen live. CLAIMS rows that name an older commit are historical.
   - Case CTAs (`index.html` ~648, "See it in the app →") open a generic page. Relabel them generic ("Try your own request →" / "Open the Kitchen"). If lane B adds a pre-fill param to /request (`?q=` or `?text=`; today only `?menu=` is read), the CTA carries the recorded ask instead. Pre-fill only, no auto-run: no spend or order on a click. The user hasn't decided whether to ask B.
   - The Source link (github.com/iloos/junction-2026) 404s while the repo is private. That is the lead's publish call; add no new links to it.
2. **W4 re-record** when prod changes: `node site/record/record.mjs`. First confirm the same-key retry fix is on prod (on `b10cd43`, one-receipt FAILed with 422 and the full run would drop that card) and that 0d's seed titles no longer say "covers". Send the new `cases.json` to 91 before deploying.
3. **73's open items:**
   - (a) Safari/iOS: the /how map's sticky trace stage, `svh` units, and the /story side dots.
   - (b) The plan slide's three panes have uneven heights; trim the plan pane if the recording grows.
   - (c) The user's "too dense, multi-font, greyed" note on /how: remove any remaining mono or grey second lines in the rules columns and flows.
   - (d) If record.mjs renames case ids or reorders steps, update `RUN` in story/index.html (why/line step indexes) and the map's trace bindings, then re-check the stop mapping with 91.
4. **Ops dashboard brainstorm.** The user's notes: an orders diff view (asked → proposed → signed → ordered) that doubles as the approval and supplier side. Waiting on the user's first-minute answer; then a brief for 9c through the lead.
5. **App pages** (Usual order, How ordering works): design `8f5b208` in docs/superpowers/specs, waiting for the user's approval.
6. Widen /how's "On a request, a product that breaks a stated requirement…" to menus when 91 reports D16 fixed on prod.

**Risks:**
- `cases.json` goes stale whenever prod changes behaviour. Re-record and send to 91 after each app deploy that touches planning or the gate. The chat plan varies per run, so a re-record can change the plan slide.
- Copy carries 91's narrowings word for word; a rewrite that drops one reintroduces an overclaim.
- The fanned deck, the map's scroll trace and the /story motion are tested in Chromium only; no Safari or real touch device yet.
- Deploys upload the working tree (see Resume).

## Resume
- Branch `lane/site`, worktree `../junc26-lanes/site`. 73's `lane/site-design` (`../junc26-lanes/site-design`) is merged and retired.
- **Deploy only commits 91 has cleared, from a clean export, never from the working tree:**
  ```
  rm -rf <scratch>/site-export && mkdir -p <scratch>/site-export
  git archive <cleared-sha> site | tar -x -C <scratch>/site-export
  cd <scratch>/site-export/site && npx wrangler@4 deploy
  ```
  Wrangler is OAuth-logged in on this machine (the user's personal Cloudflare account). If it isn't, run `npx wrangler@4 login --browser=false` and have the user open the link in their personal Chrome profile. The Worker is `mandate-landing`, with custom domains mandate.kitchen and www (www → 301 to the apex; unknown paths → 302 to app.mandate.kitchen).
- **Re-record:** `node site/record/record.mjs` from the worktree root (`--only sponsors` for one part). Plain fetch against `https://app.mandate.kitchen`, each case in a fresh sandbox, about 7 Gemini calls. `CHAIN_KITCHEN` picks the chain's kitchen (default `k-lounas`). Every value is asserted, so a FAIL means prod changed.
- **Local preview:** serve `site/public` over HTTP (Playwright blocks `file:`), and check 1440 and 390 px with light and dark system settings. Landing and /proof are pinned light; /story and /how are pinned dark.
- **Design check:** `impeccable detect site/public` (ignores in `site/.impeccable/config.json`).
- **Verify live:** `curl -s https://mandate.kitchen/cases.json` (appCommit, recordedAt).
- 73's review sources: `Junc26/scratch/site-review/SYSTEM-MAP.md` and the screenshot scripts `scratch/site-review/*.mjs` (gitignored).
