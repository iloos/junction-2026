# Valio Aimo data and mock API

_Sat 14 Nov 00:30 (Helsinki), full probe of the static files and ~55 live calls. Numbers are over all 17,546 products unless stated. **(?)** = inferred, not documented._

**Files.** Aggregate profile (committable, no product rows): [valio-profile.json](valio-profile.json). Probe scripts (rerunnable, key from env `VALIO_API_KEY`): `scripts/probe/valio_profile.py` (static data), `scripts/probe/valio_probe.py behaviour|limits|heroes` (API), `scripts/probe/valio_cache.py` (cache-through client). Valio's data stays out of git in `data/valio/probe/`: `sample.json` (200 products, seed 42: heroes + 80 with carbon and reliability + random), `sample_ids.json`, `heroes.json`, `heroes_priced.json`, `api_findings.json`, `name_vs_netweight.json`. Raw API responses: `data/valio/cache/`.

## 1. Product data (static file)
**Shape:** `{id, salesUnitGtin, salesUnit, baseUnit, category, allowedLotSize, deleted, temperatureCondition, vendorName, countryOfOrigin, units[], deposits[], substitutions[], synkkaData{…}}`. Ids are 6-digit strings 460000–477545, no duplicates, no duplicate GTINs.

| Field | Fill | Notes |
|---|---|---|
| id, category, vendorName, salesUnit, baseUnit, units, allowedLotSize | 100% | `deleted` is always false (deleted products are excluded) |
| countryOfOrigin (ISO-2) | 99.9% | 98 countries: fi 7,849 (45%), de 1,029, it 977, se 874, cn 741, nl 659, fr 599. 182 say `fi` while Synkka's numeric origin lacks 246 |
| temperatureCondition | 99.7% | codes only (see below) |
| salesUnitGtin | 99.1% | |
| **substitutions** | **1.1%** (189 products, 250 rules) | Valio's own substitute rules. 92% same category, 100% resolvable. Not in the CONCEPT yet |
| deposits | 2.9% | 7 deposit materials (crates, bottles) |
| synkkaData block present but thin | 17.5% have only names + classifications | 82.5% have the full GS1 record |
| names fi / en / sv | 100 / 100 / 92% | 17.6% all-caps abbreviated ("LOHIFILEE N10KG/LTK C-LEIKAT RUODIT"). 140 products share a Finnish name with another. 58 names carry POISTO/VANHA flags |
| brand, gtin, vatCode, producers, unitConversions | 82.5% | vatCode has dirty values ("MEDIUM MEDIUM") |
| keyIngredients (text) / ingredients (structured) | 80% / 21% | structured origins per ingredient 20% |
| nutritionalContent | 70% | energy, protein, fat, carbs, salt, sugar ~68%; fibre 35%; lactose 20% |
| marketingTexts fi/sv/en | 68 / 64 / 63% | |
| allergen group with values | 41% | GS1 codes (AM milk, AW gluten, UW wheat, AY soy, AE egg, AN nuts…) with CONTAINS / MAY_CONTAIN / UNDECLARED. **Absent ≠ allergen-free** |
| nutritionalClaim with values | 43% | FREE_FROM LACTOSE 4,499, GLUTEN 3,047, VEGAN 2,959, VEGETARIAN 2,358 |
| packagingMarkedLabel | 98% (mostly temperature words) | Hirvenmerkki BLUE_SWAN 2,057, MADE_IN_FINLAND 1,772, Sydänmerkki 826, **EU_ORGANIC 456**, Svanen 362, MSC 104, ASC 51, Fairtrade 92 |
| min/maxTemperature | 58% | |
| storage / usage / preparation instructions | 49 / 21 / 20% | |
| fishingReports | 2% | species codes (TRR trout 79, SAL salmon 70, HER herring 59) + FAO areas |
| **medias** | 76% have ≥1 (68% a primary) | **only `{id, primary}`: no URL, no file.** Nothing to HEAD-test; images are not in this dataset |

**Categories:** 349 five-digit codes, **no names anywhere** (schema, portal and API all say so). Median 32 products per code (max 443). The 2-digit prefix is a usable top level (18 groups). Our heuristic labels from English name words: 41 frozen (3,262), 21 dry/ambient grocery (3,219), 17 chilled ready food and deli (2,237), 22 coffee/spices/baking (1,902), 10 dairy and bread (1,524), 18 fresh meat and fish (608), 52 confectionery (628), 85/84 drinks; **non-food ≈ 4,000**: 63 napkins and cleaning (1,817), 64 disposables (1,039), 20 tableware (889), 90 office (224). Per-code word hints are in `categoryLabelHints` of the profile. Vendors: 648; top Duni 817, Valio 788, Atria 300, Gavrielides 284, HKFoods 266, Feelia 260.

**Temperature classes (inferred from median min/max °C):** 8 ambient 10–22 (10,053), 7 frozen −25…−18 (3,152), 4 chilled 4–8 (1,803; dairy), 3 chilled 2–6 (1,673; meat products, ready food), 2 chilled 2–4 (324; fresh meat, salad), 1 fresh 0–3 (240; fresh fish, fresh meat), 5 produce 2–7 (221), 6 and 9 (≤10 each), null 61.

**Units.** Sales unit: KI case 8,005, ST piece 5,607, KG 1,068, PAK 880, BAG 697, then RAS/PRK/BOT/SK/CS… (17 codes, no translations). Base = sales for 62%. `units[]` gives the hierarchy (KI p50 6 base units, KRS layer p50 60, PAL p50 288, max 56,000). `allowedLotSize` is 0.01 for 96%; the 4% that differ are almost all **KG catch-weight items with a minimum step of 1.5–15 kg** (whole fish, meat). Weight: `unitConversions.netWeight` exists for only **56%** (base level 46%; the menu-spike's "82%" counted the block, not the value). Adding sizes parsed from names and KG-sold items, **89%** can be given a weight or volume.

**Data quality to design around:**
- Name size vs base-unit net weight disagree for **11% of 6,013 checkable products** (multipacks, "n. 42×120 g", disposables with kg ratings). Price confirms some: "Valio Eila voi 4x5 kg" costs €37.33 per ST, so ST is one 5 kg block, not 20 kg.
- Package words are in the names only ("10KG/LTK", "2,5/1,25KG" = gross/drained weight).
- Seasonal products are listed but not deliverable (see API).

## 2. Joins
| | Rows | In catalogue | Notes |
|---|---|---|---|
| Carbon `AVG kg CO2-eq/kg` | 11,033 | 62.9% | **Only 177 distinct values**: a product-group average (the portal says so), not per product. p5 0.38, p50 2.11, p95 10.1, max 30.5. Beef 26.2, lamb 30.5, Finnish cheese 5.1, butter 6.6, milk 1.1, oat drink 0.44, salmon/trout 4.9–6.4, potatoes 0.2. Non-food has ~0% coverage, food prefixes 75–90% |
| Delivery reliability 0–1 | 4,425 | 25.2% | 56% exactly 1.0, p5 0.87, p10 0.94; 6.6% below 0.9; **94 below 0.7** (good "unreliable supplier" cases). Mean Stock 0.98, Terminal 0.96 |
| All three | 3,123 | 17.8% | 1,302 have reliability but no carbon |

Carbon is not constant within a category (68% of categories have one value; the rest mix 2–4 groups), so category-level imputation is reasonable but should say "estimated from category".

## 3. Mock API behaviour
Base `https://junction26.valioaimo.fi`, header `X-API-Key`, Cloudflare in front. Bad key → 401 `{"detail":"Invalid or missing API key"}`. `GET /api/ping` → `{"status":"ok"}`.

**Price** (`POST /api/price`): `{customerId, currency:"EUR", pricingDate, products:[{productId, quantity:1.0, catalogPrice{value, valueWithTax, validFrom, validTo, currency}, priceWithTax, comparisonPrice, comparisonUnit, tax{taxRate, taxValue}, listPrice, netPriceFound, error}]}` in request order.
- `catalogPrice.value` = **the price we pay, per sales unit, ex VAT**; `priceWithTax.value == catalogPrice.valueWithTax`. `listPrice` is 15–20% higher (p50 discount 18%, max 76%). `netPriceFound` true for ~1.6% (a customer net price, valid to 2026-12-31, bigger discount 14–33%); otherwise validTo 9999-12-31.
- `comparisonPrice` per KG (62%) or L (14%), null for 24% (pieces, non-food). For KG-sold items it equals the unit price. Tax 13.5% (food) or 25.5%.
- Prices p50 €22.3, p90 €77, p99 €164 per sales unit. Examples: lactose-free milk 1 l €1.56, salmon fillet €14.11/kg.

**Availability** (`POST /api/availability`): `{timeNow, requestedDate, products:[{productId, closingTime, salesBlock, logisticModel, scheduleLines:[{salesBlock, availableAmount, availableDate, salesUnit}]}]}`. Over 6,956 products seen:

| Case | Share | Meaning for us |
|---|---|---|
| Terminal, amount 999999 | 42% | supplier-delivered, quantity unknown (documented) |
| Stock, real amount | 31% | p10 4, p50 38, p90 430 sales units; **479 products below 10** (real shortages at kitchen scale) |
| Stock, amount ≥ 1e8 (9999999999, 2499999999, 555555555…) | 8% | "unlimited" sentinel divided by a unit factor **(?)**. Treat ≥ 1e6 as unlimited |
| Stock, amount 0 (no availableDate) | 2% | out of stock now |
| `scheduleLines: []`, no logisticModel, no closingTime | **18%** | cannot be delivered on any date. Includes Christmas foods (Lanttulaatikko, Rosolli) and Valio's own substitute 464440 |
| salesBlock true | 3 products | Laskiaispulla (Shrove buns) with availableDate 30 Dec: seasonal block |

- **`requestedDate` and `customer` change nothing.** Today, +3, +14 days, a Sunday and a past date returned identical bodies; `availableDate` is always the earliest date, **Mon 16 Nov**, whatever we ask. Two customers returned identical prices (as the docs say). Repeating a request returned identical data: **deterministic, not randomised**, at least within minutes.
- `closingTime` is the order cut-off for that `availableDate`. Stock items: Sun 15 Nov 17:00 (one day before). Terminal items: Thu 12 or Fri 13 Nov 10:30–16:00, i.e. 3–4 days lead time, **already in the past at probe time** while `availableDate` still says Mon 16. A mock inconsistency; we should read it as "lead time" (cut-off = delivery − (availableDate − closingTime)) **(?)**.
- `salesUnit` in the schedule line equals the product's salesUnit in 99%.
- Errors: unknown id → 200 with `error:true` (price) or empty scheduleLines (availability), so **an unknown id looks like "not deliverable"**; validate ids against the catalogue first. Bad date, empty list, missing customer, 1,001 ids → 422 with pydantic `detail[]`.

## 4. Limits
Ramp through the cache helper, distinct keys, 200 ids per call: concurrency 1 (3 calls) p50 166 ms; 2 (4) 118 ms; 4 (8) 154 ms; 8 (16) 172 ms, all 200. 1,000 ids: price 310 ms / 699 kB, availability 257 ms / 202 kB. **No rate-limit headers** (only Cloudflare `CF-RAY`, `Cache-Control: no-store`), no 429 seen. Rate limits are "undisclosed"; blocking would most likely show as 429 or a Cloudflare 403/1015 page **(?)**.
**App settings:** max 4 concurrent, ≤ 200 ids per call (1,000 allowed but unneeded), at most ~2 req/s sustained, exponential backoff from 2 s with jitter on 429/403/5xx and a circuit breaker that falls back to the cache/simulator after 3 failures. Only query ids that are on an order or a shortlist (Valio's rule).

## 5. Cache (what the CatalogPort adapter mirrors)
`valio_cache.call(endpoint, customer, requestedDate, ids, refresh=False)`:
- **Key** = `endpoint|customer|requestedDate|sorted(ids) joined by ","`; file `data/valio/cache/<endpoint>/<sha256(key)[:20]>.json` = `{key_hash, endpoint, customer, requestedDate, products, status, latency_ms, fetched_at (UTC), headers, tag, body}`. Append-only `data/valio/cache/index.jsonl` (hash, endpoint, customer, date, n, ids, status, fetched_at, latency_ms, stored, tag).
- Read cache first; on a miss call, store, return. Cache 2xx and 422 only. Never re-fetch without `--refresh`.
- **App adapter:** cache **per product** (`price:{customer}:{date}:{id}`, `avail:{customer}:{date}:{id}`) rather than per chunk, so overlapping baskets hit; batch only the misses. TTL ideas: price 24 h (validFrom/validTo say prices are stable; netPrice ends 31 Dec); availability 15 min, and stale after its `closingTime`. Since customer and date don't change responses today, keep both in the key anyway (they matter in reality). The simulator reads the same cache as its base truth, then layers scenario overrides (shortages, cut-offs) on top.

## 6. What this means for us
| Scenario | Real data? | How |
|---|---|---|
| Out of stock | **Yes** | 18% undeliverable, 2% zero stock, 479 low-stock items. Salmon fillet 462150 has 43 kg, trout 462016 40 kg: a 140-guest buffet runs short for real |
| Seasonal / blocked | Yes | Laskiaispulla salesBlock until 30 Dec; Christmas casseroles undeliverable |
| Cut-off | Partly | real closingTimes and Stock vs Terminal lead times; but they don't move with requestedDate, so the countdown must come from our simulator's clock |
| Partial availability for a date / split delivery | **No** | one schedule line, one date. Valio's milk example (1,000 l LF milk) is unlimited Stock: **simulate** "640 l Monday, rest Wednesday" |
| Substitutes | Partly | 250 Valio rules (1.1% of products) + same category + same temperature class + comparison unit for the rest |
| Carbon comparison | Yes, as group averages | 63% coverage, 177 values; ties within a category are common, so rank on carbon only across categories (beef 26 vs chicken vs plant) |
| Reliability | Yes, 25% | 94 products below 0.7 make a good "this supplier is late" warning |
| Finnish origin, organic, MSC/ASC | Yes | countryOfOrigin + labels (Hirvenmerkki, Sydänmerkki, EU organic) |
| Pack sizes that don't fit | Yes | KG items with 1.5–15 kg lot steps, case-only items (KI), 11% name/weight conflicts |
| Customer-specific prices | No | price ignores customer: simulate kitchen contracts if we want them |
| Product images | **No** | media ids only. Cloudinary needs another image source (ask Valio) or drop it |

**Normalised product model** (one row per id; provenance per derived field: `valio` / `parsed` / `category-estimate` / `llm` / `web:<url>`): `id, gtin, nameFi, nameEn, nameShort (LLM, readable), category, categoryGroup (prefix2), categoryLabel (LLM), isFood, vendor, brand, origin (ISO-2), isFinnish, labels[] (organic, MSC, ASC, Hirvenmerkki…), temperatureClass (ambient/chilled/frozen/fresh), salesUnit, baseUnit, packs[{unit, baseUnits}], lotStep, netQtyPerSalesUnit + qtyUnit (g/ml/pcs), catchWeight (variableUnit or lotStep>0.01), co2PerKg, co2Source, reliability, allergens{contains[], mayContain[]}, freeFrom[], diet[] (vegan, vegetarian), substitutes[] (Valio rules first), hasNutrition, mediaIds, dataQualityFlags[] (name-weight conflict, POISTO/VANHA, thin record)`. Live fields stay outside it: `price{unit, perKgOrL, list, validTo, fetchedAt}`, `availability{model, amount|unlimited, date, closingTime, blocked, fetchedAt}`.

**Enrichment batch must fill:** category labels (349 codes); `netQtyPerSalesUnit` for the 11% without any weight and resolve the 11% conflicts; carbon for 37% (category-average first, LLM second, flagged); `isFood`; readable short names and an English gloss for all-caps names; an "allergen data missing" flag (59% have none); substitute candidates for products without rules (embedding + same category/temperature, LLM rerank). Reliability for the other 75% should stay "unknown", not invented.

**Hero products** (price ex VAT on 17 Nov; availability as returned):
| Role | Id | Product | Pack | Price | CO2 kg/kg | Rel | Avail |
|---|---|---|---|---|---|---|---|
| Valio's example | 464201 | Valio kevytmaito 1 l laktoositon UHT (fi) | ST, KI=10, PAL=600 | €1.56 (€1.56/l) | 1.1 | 1.0 | Stock, unlimited; rule → 464440 (0.5 l, undeliverable) |
| alt milk | 464073 / 463335 | täysmaito 1 l LF UHT / Eila 3% 1 l | ST, KI=10 / KI=5 | €1.64 / €1.40 | 1.1 | 1.0 | unlimited; 464073 rule → Arla 12×1 l 464768 (€30.42/KI, Terminal) |
| oat alternative | 470863 | Oatly Kaurajuoma Kevyt 1 l (se) | ST, KI=6 | €1.40 | 0.44 | 1.0 | 1,414 |
| salmon (out) | 462150 | LOHIFILEE C-leikattu 10 kg (no) | KG | €14.11/kg | 4.9 | 0.96 | **43 kg** |
| Finnish trout | 462016 | KIRJOLOHIFILEE C-leikattu 10 kg (fi) | KG | €15.77/kg | 4.9 | 1.0 | **40 kg** |
| unreliable trout | 471898 | Kalaneuvos savukirjolohifilee buffet n700 g | KG | €22.30/kg | 6.0 | **0.33** | **0** |
| Christmas ham | 462919 | HK Joulun Juhlakinkku viipaloitu 2.5 kg (fi) | ST, KI=4 | €29.20 (€11.68/kg) | 10.1 | 1.0 | Terminal, cut-off Thu |
| whole ham | 462490 | HK Juhlakinkku potkalla 6–8 kg (fi) | KG | €6.37/kg | 6.2 | – | **0** |
| casserole (out) | 462482 | Saarioinen Lanttulaatikko 700 g | ST, KI=6 | €4.09 | 2.2 | 1.0 | **0**; 2–2.8 kg Kymppi/Valio versions undeliverable |
| beef vs plant | 470418 | Snellman naudan jauheliha 17% 2 kg | ST | €25.20 | **25.6** | 1.0 | 61 |
| butter | 463437 | Valio Eila voi 500 g laktoositon | ST, KI=20 | €3.31 | 6.6 | 1.0 | unlimited; rules → 200 g, 4×5 kg |

## Decisions for ARCHITECTURE
1. **Static catalogue is the truth for search and ranking; the API is called only for shortlisted ids** at quote and order time, through a cache-through CatalogPort (per-product keys, 4 concurrent, ≤200 ids per call, backoff + breaker to fixture).
2. **The simulator owns time and scarcity.** It starts from cached real responses and overlays scenario events (split delivery for the milk, salmon shortfall, cut-off countdown). Every value in the UI says whether it came from Valio live, the cache, or the simulator.
3. Treat `availableAmount ≥ 1e6` as unlimited, `[]` as undeliverable, `0` as out of stock, Terminal as "unknown quantity, longer lead time".
4. Validate ids against the catalogue before calling (unknown ids masquerade as undeliverable).
5. Substitutes: Valio's `substitutions` first (shown as "Valio's rule"), then same category + temperature class + comparison unit, then LLM rerank by the kitchen's weights.
6. Carbon is a group average: show it as such, rank across groups, never claim per-product precision.
7. Filter non-food (prefixes 20, 30, 32, 63, 64, 67, 77, 90) out of menu matching.
8. No product images from Valio: Cloudinary moves to "Could" unless mentors give an image source.

## Open questions for Valio's mentors
1. Image files for `medias[].id`: is there a URL pattern or CDN we may use?
2. Category names for the 349 codes (or the hierarchy behind the prefixes)?
3. Is `closingTime` in the past for Terminal items intended? Will `availableDate`/`closingTime` move with the clock during the weekend?
4. Is `availableAmount` 9999999999 (and 2499999999 etc.) "unlimited" for Stock items?
5. Unit code meanings (KI, KRS, RAS, PRK, SK, KLE, ZML…), temperatureCondition 1–9 names.
6. Are the `substitutions` rules what Aimo actually offers customers today? Are there more?
7. What rate limit should we stay under, and how does blocking show?
8. Real numbers for the pitch: share of lines short-shipped, typical cut-offs and delivery days for a Helsinki hotel.
