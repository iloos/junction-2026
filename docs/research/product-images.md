# Product images: OFF → manufacturer page → Gemini check

_Probe, Sat 14 Nov 2026. 50 product ids from `fixtures/seeds/christmas-buffet-140.json` + `kitchens.json`, mapped through `data/valio/normalized/products.json`. Script and raw JSON in the session scratchpad (`images/chain.py`, `off.json`, `exa.json`, `verify.json`, `verify2.json`). No image bytes were saved; nothing touched `*.valioaimo.fi`._

## Method
1. **OFF** `api/v2/product/<GTIN>` (≤1 req / 2.6 s, generic UA). The 7 GTINs starting `2` (variable weight) were skipped.
2. **Exa** `/search` (`type:auto`, 5 results, `includeDomains` = 24 Finnish manufacturer domains), query `"<nameFi> <brand> tuote"`. We prefer the brand's own domain.
   - **v1** used Exa's indexed `image` (og:image) as it came.
   - **v2** re-fetched the live product page, then took the image from JSON-LD `Product.image`, else a non-logo `og:image`, else the first PIM/`tuotekuva` `<img>`.
3. **Gemini** `gemini-3.5-flash-lite` `generateContent` checked each candidate: image inline, catalogue facts (name, brand, vendor, pack size, GTIN, variable-weight flag), temperature 0, `maxOutputTokens` 800, thinking `minimal`, JSON schema `{match, isPackshot, seenText, brandMatches, sizeMatches, reason}`. Each image was also re-fetched with a foreign `Referer` to test hotlink blocking.

**Spend:** OFF 43 calls. Exa 45 searches, $0.315. Gemini 60 calls (1 test + 41 v1 + 18 v2), 77k tokens in and 4.8k out, about $0.035. Context.dev 0.

## Coverage (best verdict per product)
| | OFF image | Manufacturer image | Total |
|---|---|---|---|
| verified **yes** | 4 | 10 | **14 / 50** |
| unsure | – | 9 | 9 |
| no (wrong item, logo, lifestyle) | 1 | 20 | 21 |
| nothing usable (404/403, no hit) | – | 6 | 6 |

The fix that mattered was v2. Exa's indexed og:image as-is (v1) gave 2 yes out of 45. Live-page extraction (v2) gave 8 yes out of 19 tried.

**Hero products**
| Id | Product | Result |
|---|---|---|
| 462490 | HK juhlakinkku 6–8 kg | **unsure.** A real packshot on hk.fi; brand and variant read right; no size is printed, because it is sold by weight |
| 476768 | HK Palvikinkku | unsure (lifestyle photo) |
| 463159 | Mattila saunapalvikinkku | unsure (lifestyle photo) |
| 462919 | HK Juhlakinkku viipaloitu | no (sliced ham on a board) |
| 476648 | Vataja maalaiskinkku | no (Landeli page has only a logo) |
| 462482 | Saarioinen lanttulaatikko 700 g | **yes** (Saarioinen PIM packshot) |
| 462150 / 462016 | Salmon / trout fillet 10 kg | no. These are Valio Aimo own-label raw fillets with no manufacturer page; Exa found Kalaneuvos consumer packs |
| 464201 | Valio kevytmaito 1 l UHT | **yes** (OFF) |

## Examples
- 462482: `cdn.saarioinen.adeonapim.com/products/3035/file/mainImage/600pix%20webp?modified=…` from saarioinen.fi. **yes**; it read "Saarioinen Lanttulaatikko 700g".
- 463437 Valio Eila voi 500 g: `valio.fi/cdn-cgi/image/format=auto/https://cdn-wp.valio.fi/valio-fi/2026/05/valio-eila-laktoositon-voi-31065-800x800.png` from the JSON-LD. **yes**. The v1 og:image for the same product was a salmon recipe photo, **no**.
- 462490: `hk.fi/cdn-cgi/image/…/tuotekuvat/tuotemerkit/hk/3941-hk-tuoresuolattu-viljaporsaan-juhlakinkku-potkalla-20261103223506.png`. **unsure**, only on size.
- 462447 Saarioinen lanttulaatikko 2,8 kg: the page's image is the 700 g pack, so **no** on size. Gemini caught 3 wrong pack sizes like this (2,8 kg, 3 kg, 6 × 400 g).
- 464073 Valio täysmaito UHT on OFF: `images.openfoodfacts.org/…/6408430011674/front_en.3.400.jpg` came back **no** ("fresh milk, not UHT"). It read HYLA, Valio's lactose-free brand, so this may be a false negative or a stale OFF photo.

## Failure modes seen
- **Site-default og:image.** Saarioinen, Feelia, Landeli and Vaasan serve a logo or banner. This was the biggest cause of "no".
- **Lifestyle photos.** HK ham, Valio pastry, Fazer and Mattila pages show dishes, not packs, so the verdict is unsure.
- **Wrong variant or size.** A sibling or consumer pack appears on the foodservice page, or a recipe page ranks first. Vörlö's swede page shows beetroot.
- **Stale index URLs.** 5 of Exa's Saarioinen and HK image URLs returned 404 live. Live pages carry timestamped URLs (`?modified=`, `…-20261103223506.png`) that rotate when the PIM republishes.
- **Bot blocking.** atria.fi returned 403 to our UA. No Referer-based hotlink blocking was seen (41/41 images loaded with a foreign Referer). No signed or expiring URLs were seen, but HK and Valio go through Cloudflare `cdn-cgi/image` transforms.
- **Gemini leniency.** It once said yes with "weight not visible" (Myllyn Paras korppujauho), so the display rule should check the fields, not only `match`.

## Time and cost per product
OFF takes about 0.15 s, but the rate limit adds a 2.5 s gap per product. Exa takes 1.65 s median, the live page fetch 0.28 s, the image fetch about 0.2 s and Gemini 1.3 s (about 1.3k tokens in). The manufacturer path is **about 3.5 s and $0.008 per product**. The OFF path is about 1.5 s and $0.0006. A cold run over 50 products takes about 3–4 min, so this is a batch job, never per request.

## Recommendation
- **Run it offline as a batch and cache the results.** Write `{productId, source: off|manufacturer, imageUrl, pageUrl, domain, licence, verdict fields, checkedAt}` to a gitignored `data/images/verdicts.json`, or to a `product_image` table seeded from it. Re-check a URL when it 404s or after 7 days. The demo reads only the cache, and the fixture path is that same file.
- **Chain:** OFF, then Exa used only to find the page, then a live fetch of the page with JSON-LD → non-logo og:image → PIM `<img>`, then Gemini.
- **Show an image only if:** `match=yes`, or a variable-weight product where `isPackshot && brandMatches && sizeMatches=not-visible` (this admits the hero ham). `unsure` and lifestyle photos are never shown as the product.
- **Display:**
  - Copy OFF images into the cache with "Image: Open Food Facts contributors, CC BY-SA".
  - Show manufacturer images **only by hotlinking the source URL**, with a "source ↗" link to the page. Never copy or re-host them.
  - When a hotlink fails (`onerror`) or nothing is verified, fall back to a dish illustration or category icon.
- **Own-label raw goods** (salmon, trout, swede, eggs) will never have a packshot, so use the icon or dish image for them. For the remaining heroes, a hand-checked override list of about 10 URLs is cheaper than tuning the chain further.
