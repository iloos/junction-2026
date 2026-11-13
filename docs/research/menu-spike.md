# Menu spike: Context.dev menus → Valio catalogue

_Fri 13 Nov 2026, ~25 min. Raw outputs in `scratch/spikes/menus/` (gitignored)._

**Verdict: go, with caching.** Context.dev `POST /web/scrape` with `formats.json` + a dish schema returned usable structured menus for 7 of 8 Helsinki sites (one needed the PDF link instead of the HTML page). It is too slow (6–32 s) and too non-deterministic to call live during the demo, so pre-scrape and store the menus as fixtures. Mapping dishes to catalogue ingredients by Finnish keywords gives plausible products for nearly every ingredient.

## Per site (schema: `dishes[{name, description, price, section, language}]`)
| Site | Type | Source | Result | Latency | Dishes (priced) | Lang | Notes |
|---|---|---|---|---|---|---|---|
| Ravintola Kaarti | lunch | own site `/lounas` | ok | 13.8 s | 45 (6) | fi | Daily lunch dishes have no price (one 14 € buffet price). The weekly list was dated "Maanantai 8.11.", which is not this week, so the page was stale. |
| Bardot | bistro | own site | ok | 18.0 s | 55 (53) | en | French dish names with English descriptions |
| Bistro Manu | bistro | raflaamo.fi (chain portal) | ok | 12.7 s | 30 (30) | en | Clean |
| Classic Pizza | pizzeria | own site `/menu` | ok | 31.5 s | 95 (94) | fi | Includes wine, beer and drink sections, so filter by section |
| Vibami | Vietnamese | vinelier.com (aggregator) | ok | 19.6 s | 47 (47) | en | Descriptions are rich in ingredients |
| Cafe Cardemumma | café | own site | ok | 5.9 s | 10 (10) | en | Small menu |
| Meritorppa (Hilton) | hotel | URL from search | **404** | 2.4 s | 0 | – | The search index was stale. On the live page the menus are only PDFs. |
| Meritorppa à la carte | hotel | PDF link | ok | 9.1 s | 19 (19) | en | The PDF parsed directly. Tasting menus put their courses into one description. |
| Restaurant Ahti (Arctic Vela) | hotel | `/dining` | ok, thin | 3.9 s | 2 (2) | en | Shows only a tasting-menu summary |

**Credits:** search 1, scrape (json+markdown) 5, failed scrape 1, map URLs 2. The whole spike used about 60 of 51k credits, so cost is not a concern.
**Rate limit:** 10 request units per minute. Firing 7 scrapes in parallel returned three `429 RATE_LIMITED` responses, so a batch script must throttle.
**Cache:** a repeat scrape reported `cache_metadata.status: hit` but still took 18 s and charged 5 credits, and returned 58 dishes where the first run returned 55. The page fetch is cached, but the LLM JSON extraction runs again and gives different results each time.

## Mapping test (keyword search over `synkkaData.names`, fi+en, non-deleted, shortest name first)
| Dish | Ingredients → example match (units) | Verdict |
|---|---|---|
| Bistro Manu creamy salmon soup | lohifilee C-leikattu 10 kg (KG); Valio perunakuutio 2.5 kg (KI); Valio Keittiön kuohukerma 0.5 l (KI=5×ST); purjo (KG, KI=10); tilli 1 kg (BAG); Knorr kalaliemi 1.5 kg/100 l (ST, KI=6); Valio voi 500 g (ST, KI=20); rye bread (several) | All 8 ingredients matched plausibly |
| Classic Pizza El Clásico (tomato sauce, mozzarella, basil) | Myllyn Paras pizzajauho 1 kg (BAG, KI=10); Mutti pizzakastike 4.1 kg (ST, KI=3); Galbani mozzarella block 1 kg (ST, KI=8); basilika tuore 1 kg (KI); oliiviöljy 5 l (ST, KI=4); tuorehiiva 1 kg (ST) | All 6 matched plausibly |
| Vibami rice noodle salad, lemongrass chicken | Farmer riisinuudeli 400 g (KI=30); broilerin rintafilee 2.5 kg (ST, KI=4); sitruunaruoho (KG); kalakastike 1 l (ST, KI=12); maapähkinä 1 kg (ST); avokadokuutio 1 kg (KI=6); bataatti (KG, KI=18); kevätkääryle 60 pcs (ST, KI=10); minttu/korianteri | All 9 matched plausibly |

Pack units are mixed. `salesUnit`/`baseUnit` can be KG (catch-weight produce, fish and meat), ST (each), KI (case), BAG, BOT, RAS, PRK or PAK. `units[].sizeInBaseUnits` gives case and pallet multiples (e.g. KI=20, PAL=1600). Net grams are in `synkkaData.unitConversions[].netWeight` for 14,474 of 17,546 products (82%). For the rest, parse the size from the name ("400G", "2,5 kg").

## Gotchas
- Keyword hits are noisy. "salmon" matched 91 products (kirjolohi, whole fish, smoked). "lemongrass" matched a marinated chicken product, "peanut" matched peanut oil, and a few names carry a "HYLÄÄ" (reject) flag. The matcher needs a ranker (an LLM pick from the top 10, or category filters) plus a curated alias table for the ~50 common ingredients.
- The data has unit inconsistencies. "Valio voi 4x5 kg" has base ST and KI=4, yet its base-unit netWeight is 20,000 g, so never trust a single field when computing quantity.
- Lunch-list pages are weekly and can be stale, and they rarely price individual dishes. À la carte pages are better input for "menu × covers".
- Hotel restaurants often publish menus only as PDFs, and the search index can return dead URLs. Scraping the PDF URL works.
- The extracted menus include drinks and wine. Keep sections that look like food, or add `isFood` to the schema.

## Recommended approach for the build
1. Pre-scrape about 20 menus once with a throttled script (≤1 request every 6 s, `formats.json` with the schema above), review by hand, and commit them as fixtures (`data/menus/*.json`, with source URL and date). The demo reads fixtures, and "add your own URL" calls live scraping behind the fixture port.
2. For dish → ingredients, have the LLM produce a Finnish ingredient list with grams per portion. For ingredient → SKU, use keyword or alias recall over fi+en names followed by an LLM or rule rerank. Precompute and cache this mapping for the fixture menus.
3. Convert quantities to orders with `netWeight` (falling back to the size in the name) and `units[].sizeInBaseUnits`, rounding up to the `salesUnit`. Pack-size rounding is a natural source of "held" lines in the demo.
