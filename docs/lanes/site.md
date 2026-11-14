# Lane: site (mandate.kitchen)

Owns `site/` only: the static site on the Cloudflare Worker `mandate-landing`, separate from the app. The app itself is on Aiven at `app.mandate.kitchen` (see [foundations/deploy.md](../foundations/deploy.md) § Domains). Shared with session 73 (lane/site-design): 73 owns `site/public/site.css`, `/story` and `/how/map.{js,css}`; this lane owns the landing, `/how/index.html`, `/proof`, the recorder and `cases.json`, and merges and deploys. Claims are checked by 91 (junc26-2f) before every deploy.

## Checkpoint (Sat 14 Nov, evening)

**Live on mandate.kitchen** (deployed from lane/site `23973ce`, with `/how` served from `36096f6`):
- **Landing** (light, pinned `data-theme="light"`): hero; a fanned deck of six recorded cases (milk held · salmon ordered with no approval needed · outside agent refused · butter after the cut-off · milk approved by the chef and sent 4× = 1 receipt · the buffet's ham held), product tokens (quantity, product, asked item); the recorded chain on the lunch restaurant (Lounas Ruoholahti → 320 covers → salmon soup → 11.79 kg potatoes → SPL annosperuna, inside the mandate → supplier confirmed) with counts 4 can be ordered now · 5 wait for the chef · 5 because Valio doesn't state a quantity; gate diagram; agents; real vs simulated; Go deeper.
- **/story** (dark, 73's rebuild `bbafc6f`): recorded hero rows, the two doors (an event or one item), a checks walkthrough marking only recorded stops, "Out of stock is where the work starts", the mandate quote (`.said` serif).
- **/how** (dark, `36096f6`): the earlier chain-step version. The rebuild below is not deployed yet.
- **/proof** (light): each claim → its test.
- Share image and og/twitter tags on all pages; three-tier brand mark; `app.mandate.kitchen` on Aiven with a Let's Encrypt certificate.
- `cases.json` recorded on prod `b2dfe9c` (all six cases, the chain, and `cases.#out-of-stock.trace`: need 27 kg raw / 18.9 kg served → 13 × 1.5 kg → held new product €200.59 → approved by the chef → supplier confirmed). 91 checked all of it.

**Merged, not deployed:**
- **/how rebuild** (`dac285d`, `4a19dc7`): built from `scratch/site-review/SYSTEM-MAP.md`: intro → 73's system map (`<section data-system-map id="map">`) → kitchen's rules → the agent → five flow tabs with recorded cases → checks behind each claim (+ FSMs) → what Valio sees → partners (`#partners`) → built / simulated / planned. **Waiting on 91's check** (sent with four questions: chat approval card D13, the chain in "Event to menu", Gemini Decisions "tested" vs the map's "seen live", the rule presets). Deploy with `cd site && npx wrangler@4 deploy` once 91 OKs.

**Open:**
1. 91's ruling on the /how rebuild, then deploy it (the landing's Partners card already points to `/how#partners`).
2. 73's map: a zone panel opened mid-trace is lost on the next scroll; the Gemini row's "seen live" pill covers Decisions (tested only). Sent to 73.
3. Ops dashboard brainstorm: the user's notes are in (an orders diff view asked → proposed → signed → ordered, which doubles as the approval surface and the supplier side); 9c built much of it. Open question to the user: what someone at Valio should see or decide in the first minute. Then a brief for 9c via the lead.
4. App pages (Usual order, How ordering works): design at `docs/superpowers/specs/2026-11-14-usual-order-and-ordering-journey-design.md` (`8f5b208`), builder-checked; **waiting for the user's approval**, then a plan and lane briefs for the lead.
5. Widen `/how`'s "On a request, a product that breaks a stated requirement…" to menus when 91 reports D16 fixed on prod.

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
