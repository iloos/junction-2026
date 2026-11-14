# Lane: kitchen-profiles (+ facets eval)

**Branches:** `lane/kitchen-profiles` (merged), `lane/facets-eval` (this brief) · **Worktree:** `../junc26-lanes/kitchen-profiles` · **Dev port:** 5173 · **Owner:** session 0d

## Checkpoint (Sat 14 Nov, evening)

### Done (all on main or in the lead's batch)
- **Seven kitchens** (`fixtures/seeds/kitchens.json`): P1–P3 plus P4 à la carte, P5 care home, P6 café, P8 ski resort. Weights and hard rules from horeca-profiles §2; mandate caps sized so a normal order runs alone (k-central €2,500 / €8,000 / €20,000). `0501b16`, `587b811`.
- **An event per kitchen, keyed in one place** (`src/lib/kitchen/events.ts`: `eventFor(kitchenId)`), used by `live.ts`, the event ports (`db-ports` `loadSeedEvents`), `fixture-server` and `fixture-plan`. Hotel: Christmas buffet 140 (unchanged); lounas: Wednesday lunch 320; central: school day 2,000; light events for the other four. Event entries take `share` (choice of mains, special diets) and `requirements`; the normal week is per kitchen. `b8f58db`, `b813504`.
- **D15:** all seven kitchens joinable; a kitchen without a seeded event shows its latest plan or `{ started: false, event: null }`, switching never plans, an unknown kitchen id is refused. `b813504`.
- **Vegetarian guard:** the lunch vegetable balls and the school vegetarian bake require `labels: ['vegetarian']`, met by the catalogue's diet tags (vegan counts). A meat product is rejected as a substitute, forbidden as a swap, never committed. Test `src/lib/server/store/vegetarian.test.ts` (red without the requirement). `36c3d60`.
- **Facets eval set:** `src/lib/server/evals/facets.fixture.json`, 68 real products labelled from their own ingredient lists, with traps. `c5d9db9`.

### Open
- **valo-basket: HELD** (`lane/valo-basket` @ `7ecaa9e`, pushed; brief `docs/lanes/valo-basket.md`). Off main and live off until the user, the lead and Valio all agree. No live calls since the user's last request.
- **For 1f (KitchenScreen.svelte):** hide "Plan the event" when `event === null`; use the snapshot's `event` for the pre-start header (it still shows the Christmas title for every kitchen); "The event adds €0 … to a normal week" needs other wording for an ordinary day; "2000 guests" has no thousands separator.
- **VALO-only filter** (user's idea, step 1 "likely in VALO": supplier + brand, ~70% fill on 38 live examples): proposed to the user, not started.
- **Prices:** 6 of 15 lunch/school products have no cached mock price, so they show `price_missing` in DB-less dev. Prod quotes live. Baking them in needs the probe run by the user (an agent must not read the key).

### Risks
- **Diet requirements are per seed entry, not general.** 8d is turning dish diet codes into need requirements; only VEG/VE mains should become requirements (side dishes like potatoes have no diet tags and would be refused).
- **Data gaps cut both ways:** Lagerblad's feta-vegetable patty (467290) has no diet tag, so it's refused for a vegetarian need although it is vegetarian. 19 vegetarian products in the facets set have no tag.
- **Event dates sit after the scenario clock** (Mon 7 Dec 21:40) because delivery = event − 2 days, ignoring the kitchen's delivery days. Moving the clock or an event date can push a delivery onto a non-delivery day or past its cut-off.
- **The no-event path** has no seeded kitchen to exercise it live; only the offline refusal test covers it.

## Resume
- Worktree `../junc26-lanes/kitchen-profiles`, now on `lane/facets-eval` (main `b10cd43` + `c5d9db9` + this brief). `pnpm i` is done; dev with `DATABASE_URL=` blank: `pnpm dev --port 5173 --strictPort`.
- Kitchen switch by API: `POST /kitchen-api/scenario {"action":"start"}`, then `{"action":"kitchen","value":"k-lounas"}` (cookie jar).
- Targeted tests: `npx vitest run src/lib/kitchen src/lib/core/demand src/lib/server/store/vegetarian`. Light gate: `pnpm gate --only check,lint` (from bash; PowerShell splits the comma).
- Seed generators (scratch, not in the repo) were one-off; edit the JSON seeds directly, and keep each seed's `order` equal to what `planEventDemand` computes (`events.test.ts` checks it).
