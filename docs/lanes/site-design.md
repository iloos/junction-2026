# Lane: site-design (mandate.kitchen look and the deep-dive pages)

Branch `lane/site-design`, worktree `../junc26-lanes/site-design`, off `lane/site`. Owns `site/public/site.css` (shared tokens), `site/public/story/index.html`, `site/public/how/map.{js,css}`. d0 owns the rest of `site/` (landing, `/how` page body, `/proof`, recorder, `cases.json`) and is the only deployer; 91 checks every claim before deploy.

## Done (Sat 14 Nov)
- **One system, two themes** (`4e4675e`): `site.css` has an explicit `data-theme="dark"`; landing and `/proof` pinned light, `/story` and `/how` dark. Serif only via `.said`, for a person's own words (the chef's mandate quote). Selection and focus rings themed.
- **/story rebuilt** (`d4ec131`, `06c550e`, and the 91 refinements commit): six parts, no deck chrome. Hero = three recorded requests → the product line → tier chip with its reason. Two ways in (an event or one item; no menu door exists). One scroll-driven moment: five recorded cases through the checks, each stopped where the app stopped it with the recorded reason; ticks only where backed (salmon all; ham, butter, milk "Who is asking"). Out of stock as four one-line fixes with claim-checked detail behind Why. Mandate quote as the peak, cap colour fixed. Partners, certainty swatches and claims table moved to `/how` and `/proof`.
- **/how system map** (`06c550e`): `map.js` + `map.css` mount on `[data-system-map]`; five clickable zones (doors, gate, pure rules, store, partners) with mechanism → test → status; the recorded ham line traced need → receipt on scroll using 91's sizing sentence verbatim. Static and clickable without the trace or with reduced motion.
- **Content source:** `Junc26/scratch/site-review/SYSTEM-MAP.md` (gitignored; 288 lines, checked against code at `b10cd43`): actors, entities, flows with entry points, mechanisms with tests, partners and fallbacks, built vs planned, coverage gap.

## Open
- 91 still to rule on the map's Gemini Decisions wording ("scores substitute fit").
- Landing hero right column: option A (recorded request → line → tier) offered; the user likes the existing card deck, so only propose, don't replace.
- Verify on Safari/iOS: the sticky scroll stages (`/story` checks, `/how` map) and `svh` units.
- `/how` sections 2–8 (d0) should use the same type scale as `/story` (h2 600, -0.03em; chips by tier only).

## Risks
- Every number binds to `cases.json`; a re-record that renames a case id or step order breaks the bindings silently (the static fallback text stays). The checks stage reads `steps[why]` and `steps[line]` by index (`RUN` in `story/index.html`).
- The checks stop mapping (which check stops which case) is editorial, cleared by 91 on Sat 14 Nov; re-check it if cases are re-recorded.

## Resume
- Preview: serve `site/public` (`python -m http.server 4618` from it) and open `/story/`; the `/how` map needs d0's mount tags (in `lane/site`).
- Screenshot scripts: `Junc26/scratch/site-review/{story2,map}.mjs` (run from `Junc26` with Playwright).
