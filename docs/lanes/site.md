# Lane: site (mandate.kitchen)

Owns `site/` only: the static site on the Cloudflare Worker `mandate-landing`, separate from the app. The app itself is on Aiven at `app.mandate.kitchen` (see [foundations/deploy.md](../foundations/deploy.md) § Domains).

## Self-review (Sat 14 Nov, checkpoint)
- **Solid:** landing with five case cards recorded live from prod `e9ec36c` (each in a fresh visitor sandbox; claims checked by 91 against its own runs); `/proof` (each claim → its test, from CLAIMS); the domain setup (apex Worker, `app.` CNAME DNS-only, Aiven certificate, unknown paths 302 to the app); `/how` reworked around when the agent may act alone, each condition cited to code.
- **Fragile:** the fanned deck is hand-written pointer/transform code tested only in Chromium; `overflow-x: clip` needs Safari 16+; the keyboard focus ring wraps the whole deck, not the centre card. `cases.json` goes stale when the app changes: cases 3 and 7 must be re-recorded after 8d's unknown-availability fix deploys.
- **Untested:** Safari and Firefox; a real touch device (drag was tested with emulated touch events only); the site with JavaScript off (the hero stands alone, no cards).
- **Not ready:** `/story` is still the dark mock port. The user chose one light look for all site pages (the Request-to-order and Usual-order mocks' style); `/story` and `/how` move to it, `/proof` and the landing gain serif headings.
- **Before 06:00:** re-record cases 3 and 7 once 8d is on prod; check the deck on Safari/iOS; focus ring on the centre card; restyle to the one light look; `/story` rebuilt or taken down.

## Resume
- Branch `lane/site`, worktree `../junc26-lanes/site`; head at the commit adding this file (see `git log -1 lane/site`).
- Deploy: `cd site && npx wrangler@4 deploy` (wrangler logged in on this machine; personal Cloudflare account).
- Re-record the cards: `node site/record/record.mjs` from the worktree root (plain fetch against `https://app.mandate.kitchen`; about 5 Gemini calls); then deploy.
- Design-check: `impeccable detect site/public` (ignores for site pages in `site/.impeccable/config.json`).
- Next: the user wants the Request-to-order and Usual-order/forecast mocks as real pages in the **app** (handoff `ui-mockset-to-prod.md` #10, #13, #16), which is app lane work via the lead; open question to the user: usual-order history seeded and labelled, real only, or mixed.
