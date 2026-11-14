# Lane: site (mandate.kitchen)

Owns `site/` only: the static site on the Cloudflare Worker `mandate-landing`, separate from the app. The app itself is on Aiven at `app.mandate.kitchen` (see [foundations/deploy.md](../foundations/deploy.md) § Domains). Shared with session 73 (lane/site-design): 73 owns `site/public/site.css`, `/story` and `/how/map.{js,css}`; this lane owns the landing, `/how/index.html`, `/proof`, the recorder and `cases.json`, and merges and deploys. Claims are checked by 91 (junc26-2f) before every deploy.

## Checkpoint (Sat 14 Nov, evening, updated)

**Live on mandate.kitchen** (lane/site `aa11230`; every page claims-checked by 91):
- **Landing** (light, pinned): six recorded case cards with product tokens; the recorded chain on the lunch restaurant (Lounas Ruoholahti → 320 lunches → salmon soup → 11.79 kg potatoes → SPL annosperuna → supplier confirmed; 4 can be ordered now · 5 wait · 5 because Valio doesn't state a quantity); Partners card → `/how#partners`.
- **/story** (dark, 73): "Tell it what you're cooking. It orders on its own only inside the limits you set."; the ask → plan → decision slide bound to `cases.json → plan` (chat turn on `b10cd43`: 12 dishes · 19 lines · €883.55 · 13 waiting · 3 decisions · nothing ordered; make lanttulaatikko in house €31.46); checks walkthrough marking only recorded stops; supply swatches; partner tabs; snap slides.
- **/how** (dark): intro → 73's system map (five zones, the ham trace bound to `cases.#out-of-stock.trace`) → kitchen's rules → the agent → five flow tabs with recorded cases → checks behind each claim (+ FSMs) → what Valio sees → partners (`#partners`) → built / simulated / planned.
- **/proof** (light, pinned). Darker dark theme (paper 0.155) verified on dark-mode systems.

**Open:**
1. **Prod regression (lead, B, 8d):** on `b10cd43` a /request same-key retry after approval returns 422 FORBIDDEN instead of the same receipt. The one-receipt card (recorded on `b2dfe9c`) is still literally true; re-record once the fix deploys, then send to 91. Until then a full `node site/record/record.mjs` FAILs one-receipt and would drop it, so don't run it for a deploy.
2. Re-record the chain's event text once 0d's renamed seed titles (no "covers") deploy.
3. Ops dashboard brainstorm: waiting on the user's first-minute question, then a brief for 9c via the lead.
4. App pages (Usual order, How ordering works): design `8f5b208`, waiting for the user's approval.
5. Widen `/how`'s "On a request, a product that breaks a stated requirement…" to menus when 91 reports D16 fixed on prod.
6. The chat plan varies per run (substitute rounds 1–3): a re-record can change the plan slide's counts and reply; the page renders from the JSON.

**Risks:**
- `cases.json` goes stale whenever prod changes behaviour (it already happened twice: unknown supply held, and the vegetarian fix). Re-record and send to 91 after each app deploy that touches planning or the gate.
- Deploys upload the working tree: never deploy while an agent or 73 has uncommitted edits in `site/public/` (use a scratch copy, as for `23973ce`).
- The fanned deck and the map's scroll trace are hand-written motion tested in Chromium only (Safari 16+ for `overflow-x: clip`); no real touch device tested.
- Copy carries 91's narrowings word for word; a rewrite that loses one reintroduces an overclaim.

## Resume
- Branch `lane/site`, worktree `../junc26-lanes/site`; 73 works on `lane/site-design` in `../junc26-lanes/site-design` and sends SHAs to merge.
- Deploy: `cd site && npx wrangler@4 deploy` (wrangler is logged in on this machine, personal Cloudflare account). To deploy without in-progress files, copy `site/` to the scratchpad, swap the file, deploy from the copy.
- Re-record: `node site/record/record.mjs` from the worktree root (plain fetch against `https://app.mandate.kitchen`; about 7 Gemini calls; `CHAIN_KITCHEN` picks the chain's kitchen, default `k-lounas`). Every case asserts what it shows; a FAIL means prod changed. Send the new `cases.json` to 91 before deploying.
- Design check: `impeccable detect site/public` (ignores for site pages in `site/.impeccable/config.json`).
- Verify live: `curl -s https://mandate.kitchen/cases.json` (appCommit, values); the pages in a browser at 1440 and 390, light and dark system settings.
