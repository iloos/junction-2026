# Venues: real Helsinki/Espoo/Vantaa HoReCa as simulated kitchens

_Sat 14 Nov 2026 ~01:30. Scripts in `scripts/venues/`, data in `data/venues/` (gitignored as a whole; OSM part is committable with attribution if we choose)._

**Verdict.** OpenStreetMap gives us **3,560 named venues** with coordinates in one free pass: enough for the control-room map and the swarm. Exa cheaply finds the menu or banquet pages OSM lacks. Context.dev turns 15 of them into structured menus (574 dishes). Google Places adds little that we need, costs money and forbids storing what it returns, so skip it. **Label everywhere: "Simulated customers; real public venue data." These venues are not Valio customers.**

## Counts (profile × city; covers are estimates)
| Profile (`profile`) | horeca-profiles P-code | Helsinki | Espoo | Vantaa | Total | Chains | Median covers/day (est.) | With menu |
|---|---|---|---|---|---|---|---|---|
| hotel | P1 city hotel | 80 | 15 | 19 | 114 | 53 | 220 | 2 |
| lunch_restaurant | P2 lunch | 161 | 44 | 39 | 244 | 6 | 150 | 1 |
| canteen_public | P2 (staff/student lunch) | 48 | 10 | 7 | 65 | 33 | 358 | 1 |
| a_la_carte | P4 | 921 | 155 | 134 | 1,210 | 40 | 90 | 4 |
| fine_dining | P4 | 13 | 0 | 0 | 13 | 0 | 39 | 2 |
| cafe_bakery | P6 | 442 | 95 | 69 | 606 | 103 | 116 | 1 |
| pizzeria_fast | none | 490 | 161 | 158 | 809 | 275 | 182 | 3 |
| bar | none | 406 | 43 | 50 | 499 | 4 | 40 | 1 |
| **Total** | | 2,561 | 523 | 476 | **3,560** | 514 | Σ ≈ 443k/day | 15 |

- **Classification** (`classify.py`) runs on OSM tags. The first rule that matches wins, and its reason is stored per venue (`profile_reason`). Chains are an attribute (`central_list`, from a brand tag or a known chain name), as horeca-profiles.md says. `lunch_restaurant` means the venue closes by 16:00, is open weekdays only, or has a lunch tag; any other restaurant is `a_la_carte`. Fine dining comes from `cuisine=fine_dining` or a short name list (Palace, Olo, Grön, Savoy …).
- **OSM has zero `amenity=canteen`** in the three cities. The 65 `canteen_public` venues are restaurants run by an institutional operator (UniCafe, Sodexo, Compass/Food & Co, Amica, Palmia). Public central kitchens (P3), care homes (P5) and caterers (P7) are not in OSM, so they stay synthetic.
- **Covers are estimated** (`covers_estimated: true`, with the method in `covers_method`). For the 18 venues with a seats/capacity tag: seats × turns per profile. For the 24 hotels with a rooms tag: rooms × 0.7 occupancy × 1.5 guests × 1.3. Everyone else gets a profile default × a deterministic jitter of 0.75–1.25, and chains get ×1.5. These numbers are plausible, not measured.

## Field coverage per source (of 3,560)
| Field | OSM | Exa | Context.dev | Heuristic |
|---|---|---|---|---|
| name, lat/lon | 100% | | | |
| address | 78% | | | |
| website | 64% (hotels 88%) | +5 discovered (unverified) | | |
| opening_hours | 69% | | | |
| cuisine | 49% | | | |
| brand / operator | 12% / 7% | | | |
| seats or capacity / rooms | 0.5% / 0.7% | | | |
| menu URL | 83 (`website:menu` tag; one was already 404) | 25 of a 29-venue sample (~19 right) | | |
| banquet page (hotels) | – | 4 of 5 hotels | | |
| structured menu | – | – | 15 venues, 574 dishes | |
| profile, covers | | | | 100% |

Every venue in `venues_enriched.json` has a `sources` object that names the source of each field.

## Partners compared
| | OSM / Overpass | Exa | Context.dev | Google Places (New) (desk research only) |
|---|---|---|---|---|
| What it gave | The whole base layer: venues, coordinates, hours, cuisine, website | Menu, lunch and banquet page URLs for venues OSM has only a homepage for; websites for venues with none. The company query ("hotel in Helsinki with banquet and conference catering") returned 15 relevant hotels and venues (Hotel Arthur, Paasitorni, Hesperia, Clarion …) | Structured dishes `{name, description, price, section, isFood, language}` from HTML pages. `links` parser to find menu links. Brand: title, description, address, industries, logos, colours, socials | Address, types, hours, rating, price level, website, `servesLunch/Dinner/Vegetarian/Beer/Wine`, `dineIn`, `reservable`. **No menu field** (only `menuForChildren`) |
| Cost | Free | $0.229 for 35 calls ($0.007 per domain search, $0.012 for the company search) | 180 credits for 37 calls (scrape+JSON 5, 404 1, links 1, brand 10); 50.8k credits left | Details Enterprise + Atmosphere (`serves*`) $25 per 1k, 1k free per month; Text/Nearby Search $32–35 per 1k |
| Speed | 35–55 s per type query (7 queries) | 1.3 s median, 5 s max | 13.5 s median when it works, 40 s max; failures fail fast (3–8 s) | – |
| Reliability | One 502 on the first run; the rerun succeeded on the main endpoint (a fallback endpoint is built in). Data quality depends on the mapper | ~75% of picked URLs were right. Misses: a Norwegian aggregator, a city tourism page, a blog, a same-name venue in Tokyo | **15 of 30 URLs gave dishes.** Empty for JavaScript-rendered lunch lists (Mashiro, Pisara, Palmia), for event/banquet pages (Helka, Folks packages, Hilton) and for an image price list. One OSM menu URL was a 404. Brand was solid for all 3 | Terms: only place IDs may be stored indefinitely, lat/lng for at most 30 days, and names and addresses not at all. Requires Google attribution |
| Licence | ODbL 1.0: attribute; share-alike if we publish a derived database | Search results only; the pages keep their owners' rights | Extracted facts from public pages; the pages keep their owners' rights | Google ToS, restrictive |

**Google: not worth it here.** The one thing OSM lacks that Places has is the `serves*` flags and ratings. They sit in the most expensive SKU, we may not cache them (and our demo depends on fixtures), and Places has no menus. Revisit only for a live "add your own venue by name" lookup that stores just the place ID.

**Hotels are the hard case.** Their sites publish meeting packages rather than dishes, and menus sit in JavaScript widgets or PDFs. Two hotel menus worked: The Folks Konepaja's eat-drink page (7 dishes) and **Scandic's Christmas lunch page (108 dishes, "8.–19.12.2026", sections per city)**. The Scandic page is chain-wide, so it is attached to Scandic Kallio.

## How the app should use it
- **Seeding the kitchens table:** seed from `venues_enriched.json`, one row per venue, with `id` = the OSM id. The profile maps to its P-code's priority weights in horeca-profiles.md, and `covers_per_day_est` is the base covers. Venues with no P-code (`pizzeria_fast`, `bar`) seed as "other" in the control room or are left out of the swarm.
- **Map:** all 3,560 points, coloured by profile. Show the attribution "© OpenStreetMap contributors" on the map.
- **Swarm personas:** sample from the real profile mix above (a_la_carte 34%, fast 23%, café 17% …) and use each venue's name, cuisine and hours as persona flavour. The 500 synthetic kitchens draw from this table, and the 10× stress test can resample with jitter.
- **Real menus:** the 15 `data/venues/menus/<id>.json` files are fixtures. Filter on `isFood`. Lunch lists are week-specific, so re-scrape before the demo or treat them as an example week.
- **The 3 demo kitchens** (`demo_role` in the file):
  1. **Scandic Kallio** (hotel, P1): the Christmas lunch buffet menu, which carries the "Christmas dinner, 140 guests" deviation.
  2. **Factory – Elimäenkatu** (lunch, P2): a weekly lunch list of 60 dishes for the regular week and "+80 covers on Friday".
  3. **Don Corleone Italian Kitchen** (à la carte, P4): 39 dishes, all priced, for "menu × covers" and "salmon is out".

  Alternates: Edvin Pizza (67 dishes) and Sodexo Sisäpiha (canteen, 37).

## Licence and attribution text
> Venue locations and details © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0), openstreetmap.org/copyright. Menus were extracted from the venues' public web pages with Context.dev, and the pages were found with Exa. The venues appear as simulated customers only. They have no relationship with Valio Aimo or with this project.

`osm_venues.json` and the profile columns are ODbL, so we can publish them if we attribute and share-alike any derived database. Do not commit the scraped menus or the Exa highlights (`exa_results.json` holds page snippets). Use them as local fixtures, or commit only the dish names with source URLs if we decide that's fair.

## Caveats
- Do not imply any venue buys from Valio, and do not show real venue names next to invented order volumes in public material without the label. For the video, consider renaming the demo kitchens ("a Kallio hotel").
- Profiles come from tags and a heuristic, so expect misfits, such as a lunch-only café filed as `cafe_bakery`.
- Covers are invented from defaults: 98.8% of venues have no seats or rooms tag.
- Context.dev extraction varies between runs ([menu-spike](../archive/prep/research/menu-spike.md)). The cached responses are the fixtures.
- Exa URLs are marked "unverified". A rerun of `enrich_exa.py` reproduces 28 of the 29 sampled venues (the chain grouping changed after the recorded run).

**Rerun:** run `fetch_osm.py`, then `classify.py`, then `enrich_exa.py` (needs `EXA_API_KEY`), then `pick_menu_targets.py`, then `scrape_menus.py --brand …` (needs `CONTEXT_DEV_API_KEY`, ≤7.5 requests/min, every response cached), then `enrich.py`. Cached steps cost nothing.
