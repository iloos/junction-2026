# Lane: kitchen-profiles (+ facets eval, copy sweep, simulated history)

**Worktree:** `../junc26-lanes/kitchen-profiles` (dev port 5173) · **Last branch:** `lane/history-profiles` · **Owner:** session 0d (retired after this ring; this brief is the handover)

## Checkpoint (Sat 14 Nov, wind-down)

### Done
| What | Where | SHA | On main |
|---|---|---|---|
| Seven kitchens: P1–P3 plus P4 à la carte, P5 care home, P6 café, P8 ski resort (weights and hard rules from horeca-profiles §2) | `fixtures/seeds/kitchens.json` | `0501b16` | yes |
| Mandate caps sized so a normal order runs alone (k-central €2,500 / €8,000 / €20,000; P4–P8 against rough weekly food cost; the chef's words match the numbers) | `kitchens.json` | `587b811` | yes |
| An event per kitchen, keyed in one place (`eventFor(kitchenId)`): hotel Christmas buffet 140; lounas Wednesday lunch 320; central school day 2,000; light events for P4–P8. Entries take `share` and `requirements`; the normal week is per kitchen | `src/lib/kitchen/events.ts`, `fixtures/seeds/*.json`, `live.ts`, `db-ports.ts`, `fixture-plan.ts` | `b8f58db`, `b813504` | yes |
| D15: all seven kitchens joinable; a kitchen with no seeded event shows its latest plan or `{ started: false, event: null }`; switching never plans; an unknown kitchen id is refused | `src/lib/server/kitchen/live.ts`, `lib/kitchen/backend.ts` | `b813504` | yes |
| Vegetarian guard: vegetarian mains require `labels: ['vegetarian']`, met by the catalogue's diet tags (vegan counts); meat is rejected as a substitute, forbidden as a swap, never committed | `core/mandate/validate.ts`, seeds, `server/store/vegetarian.test.ts` | `36c3d60` | yes |
| Facets eval set: 68 real products labelled from their own ingredient lists, with traps | `src/lib/server/evals/facets.fixture.json` | `c5d9db9` | yes |
| No "covers" for a head count in rendered copy (guests / lunches / meals), with a check | seeds, `establishment.ts`, `calendar.ts`, `request/sanity.ts`, `tools.ts`, `core/vocabulary.test.ts` | `598d56d` | yes |
| R12-06: simulated-history recipes for P4/P5/P6/P8 (à la carte heavier Thu/Fri; care home lactose-free, soft, almost never missed; café small daily dairy; ski hotel Tue/Fri with a quarter volume until the season opens 27 Nov) | `fixtures/seeds/usual-history.json`, `core/patterns/history.test.ts` | `ca8f9ed` | **no: `lane/history-profiles`, sent to the lead** |

### In flight
- Nothing uncommitted. `lane/history-profiles` @ `ca8f9ed` waits for the lead's merge (light gate GREEN; `core/patterns` + `server/patterns` tests 33 green).

### lane/valo-basket: HELD (separate lane)
- `lane/valo-basket` @ `7ecaa9e`, pushed to origin, **not on main**. Builds an anonymous basket in Valio's real webshop (VALO Tilauspalvelu) from a committed plan; nothing can be ordered. Brief: `docs/lanes/valo-basket.md` (on that branch), with self-review, abuse guards and resume.
- Recording is the default everywhere; live needs `VALO_BASKET=live`, which nothing sets. Unhold needs all three: the user, the lead and Valio's explicit OK (asked via their Discord contact; no reply known). No live calls unless the user is present and asks.
- Rebase on main before any merge: it branched from main on Sat afternoon.

### Next (for whoever picks this up)
1. **1f, KitchenScreen.svelte:** hide "Plan the event" when the snapshot's `event` is `null`; use `event.title/date/guests` for the pre-start header (it still shows the Christmas title for every kitchen); reword "The event adds €0 … to a normal week" for an ordinary-day event; add a thousands separator to the guest count.
2. **8d, diet codes → need requirements in core:** only VEG/VE mains should become requirements (side dishes such as potatoes 475214 have no diet tags and would be refused). Run the facets set (`facets.fixture.json`, owner 8d) as the safety eval: zero unsafe oks.
3. **Diet-tag gaps:** Lagerblad's feta-vegetable patty 467290 has no tag, so it's refused for a vegetarian need although it is vegetarian; 19 vegetarian products in the facets set have no tag. Facets from ingredient text (D16) fix this.
4. **k-central data:** the trout (462016) is really short (40 of 130 kg) and 6 of 15 lunch/school products have no cached mock price (`price_missing` in DB-less dev; prod quotes live). Filling the cache needs the user to run the probe; an agent must not read the API key.
5. **The no-event path** has no seeded kitchen to exercise it live (every seeded kitchen has an event); add a live test with a kitchen created without one once the D15 join flow creates kitchens.
6. **"Cover" in its supply sense** ("not counted as cover", "dishes lose cover") stays; reword only if the lead or the user asks.
7. **valo-basket**, if Valio says yes: rebase, test the live route path against a local fake VALO (`VALO_BASE_URL`), a "Build in VALO" panel with the agreed wording ("a basket on Valio's webshop for you to review; nothing is ordered"), and the user's "VALO only" filter idea (step 1: supplier + brand heuristic, ~70 % fill on 38 live examples).

### Risks
- **Event dates are tied to the scenario clock** (Mon 7 Dec 21:40): delivery = event − 2 days (`deliverByFor`), ignoring the kitchen's delivery days. Moving the clock or an event date can land a delivery on a non-delivery day or past its cut-off.
- **Diet requirements are per seed entry** until 8d generalises them.
- **Simulated history uses only fixture product ids** (a test enforces it); a new profile's products must appear in `kitchens.json` (`usualProducts`), the Christmas seed or `evals/retrieval/substitutes.json`.

## How to resume
- Worktree `../junc26-lanes/kitchen-profiles`; run `pnpm i` first (main adds dependencies, e.g. `uqr`). Dev: `DATABASE_URL= pnpm dev --port 5173 --strictPort`.
- Switch kitchen by API: `POST /kitchen-api/scenario {"action":"start"}`, then `{"action":"kitchen","value":"k-lounas"}` (keep a cookie jar).
- Targeted tests: `npx vitest run src/lib/kitchen src/lib/core/demand src/lib/core/patterns src/lib/core/vocabulary src/lib/server/store/vegetarian`.
- Light gate (lanes no longer run the full gate): `pnpm gate --only check,lint`, from bash (PowerShell splits the comma).
- Seeds are hand-edited JSON. Keep each event seed's `order` equal to what `planEventDemand` computes (`events.test.ts` checks it).
