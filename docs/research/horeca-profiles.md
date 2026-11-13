# HoReCa profiles, regularity and open data

_Research, Sat 14 Nov 2026 ~01:00. Builds on [horeca.md](horeca.md) (roles, par levels, BEOs, waste, tools), [valio-data.md](../foundations/valio-data.md) (catalogue and API) and D4. Personas and flows live in [PRODUCT.md](../concept/PRODUCT.md). Every source in §4 was fetched tonight; the probe scripts are in scratch, not committed. **(?)** = guess or unverified._

## 1. The wholesaler's view (Valio Aimo)
**What is public.** Valio Aimo was formed in 2021 by merging Valio's food service with Heinon Tukku ([valioaimo.fi/company](https://www.valioaimo.fi/en/company/)). It serves "from school kitchens to your local café, from Hanko to Nuorgam" through delivery wholesale (about 25,000 products from Espoo and Kuopio, usually within 24 h on **agreed delivery days**), two Cash & Carry stores in Helsinki and Vantaa, and VALO Tilauspalvelu, where orders are delivered direct from the supplier ([delivery wholesale](https://www.valioaimo.fi/en/become-a-customer/delivery-wholesale/), [VALO](https://www.valioaimo.fi/en/valo-tilauspalvelu-en)). It publishes no revenue, customer count or cut-offs; Valio group turnover was €2.28 bn in 2024 ([annual report](https://cdn-wp.valio.fi/valio-fi/2025/04/Valio-konsernin-Hallituksen-toimintakertomus-ja-tilinpaatos-2024.pdf)). The mock API gives the real cut-off mechanics: **Stock** items close at 17:00 the day before delivery, **Terminal** (supplier-delivered) items 3–4 days before (valio-data §3). Finland has 10,000–14,000 professional kitchens, and about one meal in three is cooked by one ([Taloustutkimus 2011 / MMM 2017 via JYX](https://jyx.jyu.fi/bitstream/123456789/74822/1/URN%3aNBN%3afi%3ajyu-202103242162.pdf)). Public kitchens serve about 380–400 M meals a year ([STT 2026](https://www.sttinfo.fi/tiedote/72388733/tuottajajarjestot-kotimainen-ruoka-on-investointi-ei-kuluera-380-miljoonaa-ateriaa-vuodessa?lang=fi)).

**Segments as a wholesaler sees them** (frequency and basket are our estimates (?) unless cited; ask the mentors to correct them):

| Segment | Deliveries/wk | Basket and order shape | What hurts the wholesaler |
|---|---|---|---|
| Hotel (city) | 5–6 | Wide: breakfast staples (eggs, dairy, bread, cold cuts, juice) daily; à la carte; banquets as spikes known 10–30 d ahead (horeca.md §2) | Banquet volume arrives as a last-minute order |
| Independent restaurant | 2–3 | Menu-driven, 80–200 lines, fresh fish/meat by KG | Late-night orders, many small drops, high churn |
| Chain restaurant | 2–4 | Central product list, contract prices, little freedom | Compliance; volume swings by campaign |
| Lunch restaurant (lounas) | 3–5 | Rotating weekly menu, high volume, few premium lines | Very regular, so price-sensitive and easy to lose |
| Café / bakery | 2–3 (bread often direct from bakery) | Dairy, coffee, baking, disposables | Small drop size |
| Catering / event venue | event-driven | Bursty, one-off SKUs | Unforecastable without the event calendar |
| Public kitchen (school, daycare, care home, hospital) | 2–5 per central kitchen | Tender product list, 6-week cycle, special diets | Tender rules; school holidays drop volume to near zero |
| Seasonal / ski resort | 1–3, long lead | Huge in season, near zero off season | Distance; the season start is a step change |
| Ships / ferries | per port call | Bulk, scheduled | Hard cut-offs tied to departures (?) |

**What a wholesaler optimises** (standard distribution practice (?)): forecast accuracy (stock and picking labour); **route density** (fixed delivery days per area keep trucks full, so customers can't simply pick a day); fill rate, the share of lines delivered as ordered (horeca.md cites ~98% as the substitution trigger); controlled substitution rather than silent short-ships; drop size (fewer, larger orders); cut-off discipline; and **retention**, because a lunch restaurant on a template is one price list away from leaving for Kespro or Meira Nova.

**What an agent channel changes for them.** (1) **Earlier demand signals:** a BEO signed 3 weeks ahead becomes a forecast line on Aimo's side 3 weeks ahead, not an order at T−1. (2) **Fewer manual orders:** the routine order is confirmed, not typed. (3) **Exceptions before cut-off:** shortages are resolved with an accepted substitute before picking, not discovered at delivery. (4) **Structured reasons** for every deviation ("+80 covers, Slush"), which aggregate into demand intelligence (the CONCEPT bonus). (5) **Lock-in through the gate:** the kitchen's mandate and history live with Aimo.

## 2. Profiles we support (★ = demo; all eight seed the control room)
| # | Profile | Rhythm | Typical basket | Priorities (weights) | Hard constraints | Typical anomalies |
|---|---|---|---|---|---|---|
| ★P1 | **City hotel**, 250 rooms, breakfast buffet + bistro + banquets (Helsinki) | Par levels for breakfast (daily delivery), menu for bistro, **event layer** for banquets | Eggs, milk/oat drink, yoghurt, cheese, cold cuts, bread, juice, coffee; fish/meat for bistro; Christmas items in season | Reliability 0.35, price 0.25, Finnish 0.2, carbon 0.2 | Allergen labelling on buffet; meat origin shown (Decree 154/2019) | Conference week (Slush) lifts breakfast; banquet guarantee changes at T−72 h; Christmas items undeliverable; fridge failure |
| ★P2 | **Lunch restaurant** (lounas buffet, office district, 250–400 covers/day) | Mon–Fri only; **4–6 week rotating menu**; standing order per menu week | Soup bases, potatoes, rice/pasta, minced meat, chicken, salad, dairy, bread | Price 0.5, reliability 0.2, Finnish 0.15, carbon 0.15 | Diet codes on every dish (G, L, M, VEG) | Public holiday kills a day (6 Dec, Ascension); rainy days lift covers (?); remote-work Fridays low (?) |
| ★P3 | **Public central kitchen** (school + daycare, 2,000 meals/day) | 6-week cycle (Helsinki schools run one, [hel.fi](https://www.hel.fi/fi/kasvatus-ja-koulutus/koulujen-ja-oppilaitosten-ruokalistat)); orders follow the menu calendar | Same as P2, more vegetarian (Helsinki offers two mains daily), milk | Price 0.4, Finnish 0.3, carbon 0.2, organic 0.1 | **Tender list only**; Finnish origin required for meat/milk; special diets per child; budget per meal | School holidays (autumn break 12–16 Oct, Christmas 21 Dec–6 Jan per [a Helsinki lukio](https://www.hel.fi/fi/kasvatus-ja-koulutus/makelanrinteen-lukio/opiskelu/kalenteri-lukuvuoden-aikataulut)): volume to ~0; tendered item out of stock means the substitute must also be on the list |
| P4 | Independent à la carte restaurant (~120 covers, dinner) | Menu × covers from reservations; Fri–Sat peak | Fish and meat by KG, produce, dairy, specialty dry | Carbon 0.3, Finnish 0.3, price 0.2, organic 0.2 | Catch-weight lot steps; small storage | Big party; fish out; pikkujoulu weekends |
| P5 | Care home / hospital kitchen | 365 days, cycle menu, census-driven | Dairy, texture-modified and clinical products, bread | Reliability 0.5, price 0.3, Finnish 0.2 | Clinical diets, allergens; **no missed delivery** | Norovirus or census change; holiday delivery gaps |
| P6 | Café / bakery-café | Par levels, daily | Milk and oat drink (barista), coffee, butter, flour, sugar, disposables | Price 0.4, organic 0.3, carbon 0.3 | Small fridge | Oat drink barista shortage; heatwave (ice coffee) |
| P7 | Catering company / event venue | Event-driven only | One-off menus, large single lines | Price 0.4, reliability 0.4, carbon 0.2 | Lead time vs Terminal cut-off | Headcount moves after cut-off; Vappu/graduation peaks (May–Jun) |
| P8 | Ski resort hotel (Kittilä/Levi) | Season step: Dec–Apr full, May–Nov thin | Like P1, bigger, fewer deliveries | Reliability 0.5, price 0.3, Finnish 0.2 | Long lead, 1–3 deliveries/week | Season opening; road delay; Christmas charters |

**Why these three ★:** P1 carries the Christmas event and the shortage (PRODUCT F2/F3); P2 shows the **regular** week from a **real** menu with portion grams (Jamix, §4); P3 is the constraint opposite (tender list, required origin, holiday zero), so "same shortage, different answer" is visible. **Chains** are an attribute (`centralList: true`), not a profile.

## 3. Regularity patterns (magnitudes where sourced)
**Monthly seasonality (Statistics Finland, turnover index of service industries, table 14k7, original series, mean of 2023–2025, each month as % of that year's mean; fetched tonight):**

| Month | J | F | M | A | M | J | J | A | S | O | N | D |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 56 Food and beverage service | 87 | 89 | 97 | 95 | 102 | 105 | 111 | 111 | 100 | 98 | 101 | 105 |
| 55 Accommodation | 88 | 94 | 100 | 76 | 95 | 109 | 118 | 107 | 100 | 91 | 103 | 119 |

**Hotel room occupancy, % (table 11lm, 2025):** Helsinki Jan 48, Mar 53, Jun 79, Aug 80, Oct 64, **Nov 70**, Dec 57. Kittilä (Levi): Feb 87, May 13, Dec 89. So a Helsinki hotel's November is ~1.5× its January, and a ski resort's season swing is about ×6.

| Pattern | Effect | Source |
|---|---|---|
| Weekday lunch | Mon–Fri steady, weekend ~0 for P2/P3; Friday lower (?) | horeca.md §6; Friday dip is a guess |
| Weekend dining | Fri–Sat peak for P4 (?) | common practice |
| Menu cycle | P3: 6 weeks (Helsinki schools); P2: 4–6 weeks (?) | hel.fi |
| Pikkujoulu | Weekends of ~20 Nov–12 Dec. The season has shrunk to a few weekends, and in 2025 only 20% of food restaurants expected growth | [Yle](https://yle.fi/a/74-20011250), [Yrittäjät/MaRa](https://www.yrittajat.fi/uutiset/pikkujoulukausi-pettymys-ravintoloille-iskee-eniten-pieniin-yrityksiin/) |
| Public holidays 2026 | Independence Day Sun 6 Dec; Christmas Eve, Christmas and Boxing Day Thu 24–Sat 26 Dec; New Year Fri 1 Jan; Epiphany Wed 6 Jan. Delivery days shift around them (?) | Nager.Date (§4) |
| January | Quietest month (87) | 14k7; [Yle](https://yle.fi/a/74-20140661) |
| Easter, Vappu, Juhannus | Easter: Apr index for accommodation 76. Vappu (1 May) and graduations (late May–early June) drive catering. Juhannus (19–20 Jun 2026): the city empties, cottages fill | 14k7; the rest (?) |
| Summer | Jul–Aug +11% for restaurants (terraces, tourists); lunch places and schools close or drop ~6–8 weeks (?) | 14k7 |
| School holidays | P3 to ~0; P2 near schools −; family hotels + | hel.fi, OPH |
| **Slush** | **18–19 Nov 2026**, confirmed in Linked Events (event "Slush", 2026-11-18 00:01 to 19 Nov 23:59 Helsinki time). Side events all week (e.g. "Sport Finland Network Event during the Slush Week", 17 Nov). ~13,000 attendees (?) | Linked Events API |
| Weather | Warm, dry days lift terrace venues; cold or rain shifts lunch to soups and may lift lunch covers (?). No Finnish magnitude found | FMI data available, effect unsourced |
| Paydays | No source found for Finland. Keep the factor at 1.0 and say so | none |

## 4. Open data to make the demo real (all probed 14 Nov ~00:45)
| Source | Access | Licence | Probe result | Demo use |
|---|---|---|---|---|
| **Nager.Date holidays** | `GET date.nager.at/api/v3/PublicHolidays/2026/FI`, JSON, no key | Open API (MIT code) | 200; 15 FI holidays incl. Juhannusaatto, Jouluaatto | "Thu 24 Dec is a holiday → the Christmas delivery moves to Wed 23; order by Tue 17:00" |
| **FMI open data** | WFS: `opendata.fmi.fi/wfs?...storedquery_id=fmi::forecast::edited::weather::scandinavia::point::simple&place=helsinki` (forecast) and `fmi::observations::weather::daily::simple` (history), XML | CC BY 4.0 | 200; forecast 12 points (2.2 °C); daily tday/rrday/snow | Weather factor in the "why" (only P2/P4/P6), and history for the synthetic year |
| **Helsinki Linked Events** | `api.hel.fi/linkedevents/v1/event/?start=&end=&text=`, JSON, no key | CC BY 4.0 (?); images carry their own licence | 200; **2,884 events 16–22 Nov**; Slush found | "Slush Wed–Thu → hotel breakfast +X%"; big events within 2 km of a kitchen |
| MyHelsinki Open API | `open-api.myhelsinki.fi` | n/a | **DNS fails: dead.** Use Linked Events | none |
| **Statistics Finland PxWeb** | `POST pxdata.stat.fi/PxWeb/api/v1/en/StatFin/plv/14k7.px` (turnover, TOL 55/56) and `matk/11lm.px` (hotel occupancy by municipality), JSON-stat2 | CC BY 4.0 ([stat.fi](https://stat.fi/org/lainsaadanto/copyright_en.html)) | 200; series to 2026M09 | Month factors in §3; cite in the "why" |
| **Jamix menu service** | `fi.jamix.cloud/apps/menuservice/rest/haku/public` (kitchen list), `/rest/haku/menu/{customerId}/{kitchenId}?lang=fi&date=YYYYMMDD&date2=…`, JSON, no key | **Undocumented, terms unknown** ([gist](https://gist.github.com/developerfromjokela/66a5f44fa6f887b23f1dca4d99aa49b0)); cache a few, attribute, don't crawl | 200; **44 customers, 185 kitchens** (schools, care homes, central kitchens, lunch restaurants). Next week's menu for Swing Deli, Espoo: dishes with **portion grams and diet codes** ("Yrttinen tomaattikeitto 110 g G, M") | **P2/P3's regular week from a real published menu**, with g/portion → kg → packs. Best regularity fixture we have |
| **Ruokavirasto recalls** | HTML list, [takaisinvedot](https://www.ruokavirasto.fi/elintarvikkeet/ohjeita-kuluttajille/takaisinvedot/), no RSS | Public authority info | 200, 91 kB; ~2–4 notices a month (11 Nov: plastic spoon; 9 Oct and 19 Aug: **egg recalls**) | Replayed egg recall hits the hotel breakfast (eggs on the par list) |
| **Fineli** (food composition, incl. dishes) | fineli.fi open data zip / API | CC BY 4.0 (?) | **403 Cloudflare challenge for scripts.** Download once by hand in a browser | Portion → ingredient breakdown for Finnish dishes; nutrition for gaps |
| **Agribalyse 3.1** (French LCA, 2.5k foods) | `data.ademe.fr/data-fair/api/v1/datasets/agribalyse-31-synthese/lines?q=`, JSON | Licence Ouverte 2.0 | 200; 277 hits for "lait" | Second source for carbon where Valio has none (37%), labelled "estimate, FR LCA" |
| SU-EATABLE LIFE (3,349 CF values) | [figshare 13271111](https://figshare.com/articles/dataset/SU-EATABLE_LIFE_a_comprehensive_database_of_carbon_and_water_footprints_of_food_commodities/13271111), xlsx | CC BY (?) | download returned 202 (prepared, not tested) | Cross-check Valio's group averages (beef 26, oat drink 0.44) |

Recipe datasets: the big open ones (RecipeNLG, Food.com) are non-commercial or US-centric. **Jamix portion grams + Fineli dish compositions + horeca.md §7** is enough and is Finnish.

**Demo moments these enable:**
1. "Slush Wed 18–Thu 19 Nov (Linked Events) → the hotel's breakfast covers +20% (?) on Wed–Fri → extra eggs and oat drink (quantities from the model, not yet computed), before Tue 17:00 cut-off (Stock)."
2. "6 Dec is Sunday and Independence Day: the lunch restaurant is closed anyway, but the school's Monday menu is unchanged; Christmas break from 21 Dec → P3's orders drop to 0, and the agent cancels the template."
3. "Real menu, real grams: Swing Deli's Monday soup 110 g × 320 covers = 35 kg → tomato base packs."

## 5. Regularity model for the build (small and honest)
```
covers(k, day, service) = base[k.profile][weekday][service] × size(k)
                        × Π factors(day)   // each factor = {name, value, source, url}
need(sku)  = Σ dishes on menu(day) covers × g_per_cover(dish, sku) / yield(sku)
order(sku) = roundUpToLot(max(0, need + safety% × need − onHand), pack, lotStep)
```
- **Factors**, each shown in the "why" and clamped to [0.5, 2.0]: `month` (14k7 or 11lm ratio, by profile), `holiday` (0 for closed, 0.6–0.8 for the eve (?)), `schoolHoliday` (P3 → 0), `event` (Linked Events match × profile sensitivity; Slush 1.2 for P1 (?)), `weather` (P2/P4/P6 only, ±10% (?)), `booking` (explicit, from the chef or a BEO, replaces the guess). If the source is a guess, the "why" says **"team estimate"**. No ML. A factor without a source stays at 1.0.
- **Base week** comes from the menu (Jamix for P2/P3, a scraped menu for P1/P4) plus profile covers; for par-driven lines (P1 breakfast, P6), from `par − onHand`.
- **Synthetic history** per kitchen (seeded): 52 weeks Nov 2025 → Nov 2026 of orders on the profile's delivery days. Each line = model × lognormal noise (σ 0.08 for P3, 0.15 for P4). Use the real 2025 holidays, monthly factors and FMI daily weather, so the history "remembers" last year's pikkujoulu and summer dip. Planted rates (?): 2% of lines short or substituted, one big booking per month (P1/P4), one equipment failure per quarter, one tender substitution conflict (P3). Each order records `{deliveryDate, cutoff, lines[{sku, qty, unit}], source: template|agent|manual, anomalies[]}`, and history uses only SKUs that are deliverable in the catalogue (valio-data §3).
- **Control-room mix of 500 kitchens (?):** P2 25%, P4 20%, P3 15%, P1 10%, P6 10%, P5 8%, P7 7%, P8 5%, sized lognormally. Ask the mentors for the real mix.
- **Back-test** for the pitch: forecast Nov 2026 weeks from the synthetic Nov 2025 + factors; report MAPE honestly, and label it "synthetic".

## Means for us
1. **Cache as fixtures now** (`data/fixtures/`, committed if licence allows): Nager 2026 + 2027 FI holidays; StatFin 14k7 (TOL 55/56) and 11lm (Helsinki, Espoo, Kittilä) 2023–2026; FMI daily Helsinki Nov 2025–Nov 2026 + a 10-day forecast; Linked Events 16 Nov–31 Dec (name, time, place, keywords only); Ruokavirasto recall list (2026); **3–5 Jamix kitchen menus** (a lunch restaurant, a school, a care home) for 6 weeks.
2. **Profiles P1–P8 as `KitchenProfile` seeds** (weights, hard constraints, delivery days, base covers, factor sensitivities); demo uses ★P1 hotel, ★P2 lunch (Jamix menu), ★P3 public central kitchen.
3. **`Factor{name, value, source, url, kind: data|estimate}`** in `core/`; the "why" panel lists them, so Slush, a holiday or a school break reads as a cited reason, not magic.
4. **Demo beat "Slush week":** the hotel's forecast moves with a Linked Events source chip, and extra eggs/oat drink are proposed before the Stock cut-off. Short, real, and it ties to the city the judges are in.
5. **Demo beat "same shortage, three kitchens":** the salmon/trout shortage resolved differently by P1 (reliability), P3 (tender list + Finnish required → held for sign-off) and P4 (carbon).
6. **Replay a real egg recall** (9 Oct 2026 notice) against the hotel's breakfast par list as the R1 recall fixture; label it "replay".
7. **Generate synthetic history** with the §5 recipe (`pnpm gen:data`), using real 2025 calendar/weather, and show the back-test MAPE labelled synthetic.
8. **Fineli:** one manual browser download (Cloudflare blocks scripts); check the licence on the page before committing anything.
9. **Mentor questions:** (a) delivery days and cut-offs for a Helsinki hotel vs a lunch place vs a school; (b) the customer mix by segment and orders per week; (c) how the holiday delivery calendar shifts around 24–26 Dec; (d) does Aimo see banquet demand early today, and would it use it for stock planning; (e) short-ship and substitution rate by segment; (f) do public-sector tenders restrict substitutes to the tender list in practice.
10. **Don't claim** a weather or payday effect in the pitch; they are factors at 1.0 or estimates until a source says otherwise.
