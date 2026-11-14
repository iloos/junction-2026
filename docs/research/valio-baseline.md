# Valio Aimo today: the webshop and assistant baseline

**Sources:** the challenge test account on toimitustukku.valioaimo.fi, Minun Aimo, and the challenge portal, browsed read-only on Sat 14 Nov (credentials in the gitignored `Misc/` photo, never in git; nothing ordered or changed; a cart line already in the shared account was left alone). Screenshots of these pages and of the deployed Mandate build: `scratch/valio-baseline/` (gitignored). Real product UI and branding: reference only, don't copy the design or put Valio's UI in the repo.

## What the webshop does
| Area | What's there | Note for us |
|---|---|---|
| **Navigation** | Products (favourites, frequently bought, offers, novelties, seasonal, 8 categories with counts) · Orders (order management, **order templates**, claims, reports) · News. Separate services in the top bar: Pikatukku (cash & carry), Toimitustukku (delivery), VALO order service, Minun Aimo | The buyer's home is a catalogue and campaigns, not "what needs me" |
| **Delivery date** | A header calendar: one **cart per delivery date**; legend: today, selected, confirmed order, open cart | Matches our "plan per delivery day"; we add cut-off and what's at risk |
| **Product card** | Price per sales unit, **comparison price (€/kg, €/l)**, VAT price, stock count ("44 kpl varastossa", "999+"), delivery promise ("Toimitettavissa 18.11.", "Saatavilla 17.11. alkaen"), badges (TARJOUS offer, KAUSITUOTE seasonal, **SPONSOROITU sponsored**) | Our line rows should speak these same fields; buyers already read them |
| **Product page** | Ingredients, **allergens**, origin, manufacturer, nutrition, **unit conversions with EANs** (kpl → ltk → krs → pal), "not on sale between dates", **notify me when available** | Packaging levels and allergens are on screen; our rounding and allergen checks extend what they know |
| **Out of stock** | "Ei saatavilla" + **"Katso korvaavat"** opens a quick view of **"Samankaltaisia tuotteita"** (similar products): no reason, no allergen comparison, no quantity mapping. Example: Ferrero Rocher (nuts, soy, wheat) → Panda chocolates, with allergen differences not shown | The exact gap our rescue fills: a reason line, allergen diff, pack and quantity fit, rule-based rejections |
| **Order templates** (*Tilauspohjat*) | Named product lists moved to a cart for a chosen date in one click. Three scopes: **private** (me), **shared** (everyone on the customer number), **central** (organisation, main user only) | This is the routine baseline. Lists are moved by hand; automatic standing orders were not seen in this account. A central template is an org-level policy hook |
| **Cart** | Per date; import from file or template; save to template; Excel export; change date; customer, delivery address, payment, buyer reference; then "Siirry maksamaan" (go to payment). **No approval step, spend limit or delegation seen** | Our mandate, tiers and exact-term approval sit exactly here |
| **Orders / claims / reports** | Confirmed orders per delivery date with filters; claims per delivery date (also from an order); purchase report; fuller reports in Minun Aimo **for main users only** | A role model exists (main user vs user); claims = our receiving/short-delivery loop |
| **Search** | Category facets; **"Kollegasi ostavat usein näitä"** (colleagues often buy); sponsored results first | An agent interface must declare its ranking basis; sponsored placement isn't a substitute rationale |

## The assistant (A.I.mo)
- Webshop chat ("Powered by Leadoo AI", "AI vastaus" label, show sources). **Asked Valio's own example** ("1,000 L lactose-free milk by Monday: options and prices?"), it answered that it **can't confirm availability for Monday, pack sizes or prices from its knowledge base**, suggested searching "laktoositon maito", and for 1,000 L told the user to **contact sales service**. Quick replies cover webshop features, main user, Minun Aimo, cash & carry, e-wholesale card, "talk to a human".
- Minun Aimo: A.I.mo with prompts like "suggest Easter desserts" and "I'm looking for gluten-free pasta", plus reports, the carbon footprint of purchases, price lists, recipes, a knowledge bank, and customer sites (*Asiakkuus ja toimipaikat*).
- **Reading:** A.I.mo is a knowledge and FAQ assistant. It is not connected to price, availability, cart or authority, which is the transactional layer the challenge asks for. (One session, one question each; the Minun Aimo ask didn't complete.)

## Challenge portal
The pricing and availability APIs, product data JSON plus schema, delivery reliability CSV, and carbon CSV (product-group averages), all already in `data/valio/` and [valio-data.md](../foundations/valio-data.md). It says the product data "must not be used for anything outside of this challenge".

## Means for Mandate
1. **Pitch baseline (say it respectfully, with the date):** "We asked Valio's assistant your own example; it rightly sent us to sales, because it has no access to stock, price or authority. That missing layer is what we built." A.I.mo answers questions; Mandate acts within a mandate. Don't claim to replace A.I.mo or the webshop.
2. **Sit on top, don't rebuild.** Map our concepts to theirs:

   | Our concept | Their concept |
   |---|---|
   | Standing order (baseline) | Order template (*tilauspohja*); a central template is the organisation's default |
   | Plan per delivery | Cart per delivery date |
   | Receipt | Confirmed order |
   | Short-delivery loop | Claim (*reklamaatio*) |
   | Mandate owner / approver | Main user (*pääkäyttäjä*) |
   | Kitchen sites | Customer sites |

   Use their Finnish terms in the UI glosses so Valio's judges recognise them.
3. **What we add, which their UI lacks:** spend and policy limits plus approval bound to exact terms; delegation to agents; substitutes with reasons and allergen diffs; event/menu-based demand (recipes live separately in Minun Aimo); an open agent door; a declared ranking basis (vs sponsored placement).
4. **Speak their card fields:** comparison price per kg/l, the "varastossa" stock count, the delivery promise date and the packaging ladder. Our rows already show rounding; add the comparison price and the delivery promise.
5. **Images: not from Valio without written permission.**
   - **Why not:** the dataset has no image URLs. The webshop's media links are signed SAP Commerce URLs on `api.valioaimo.fi`, so they can't be built from a product id without calling Valio's production API, which the brief puts out of bounds.
   - **The terms say so too.** Webshop terms §2 ([terms](https://toimitustukku.valioaimo.fi/fi/terms-of-use/), 17.2.2025) prohibit public display, copying into new publications or databases, and commercial use without prior written consent.
   - **Synkka can't help.** Synkka recipients may show images in their own business but may not pass them on ([GS1 terms §2.1](https://gs1.fi/fi/datapalvelut/gs1-synkka/synkka-palvelun-palvelukuvaukset-ja-kayttoehdot)), so Valio can't sublicense them to us.
   - **The law adds two more limits.** Plain photos are protected in Finland (tekijänoikeuslaki 49 a §). Bulk extraction hits the EU database right.
   - **Open Food Facts covers few of our products.** A GTIN check of the 41 products in our seeds (14 Nov) found a front photo for **5**; 8 more are known but have no photo, and 28 are missing. 7 of the missing are variable-weight in-store codes (`23…`: ham, salmon, trout), which are never in public catalogues.
   - **Options, best first:**
     1. **Dish-level imagery we own:** a small set of consistent illustrations per dish or category, generated with Gemini image generation and labelled "illustration". Never a fake packshot or brand.
     2. **Ingredient or category icons at line level** from an open set (OpenMoji CC BY-SA 4.0, Twemoji CC BY 4.0, Noto Emoji Apache 2.0, or Lucide).
     3. **Open Food Facts photos where the GTIN matches**, in product detail only, with "Image: Open Food Facts contributors, CC BY-SA". Fetch at runtime or into a gitignored cache, with the icon as fallback.
     4. **Ask the Valio mentors in writing** for about 10 hero products' images, served from a gitignored cache.
   - **Chosen chain (judgement, not legal advice):**
     1. **Open Food Facts** by GTIN: copy allowed under CC BY-SA, with attribution.
     2. **The manufacturer's public product page**, found by Exa (discovery) or Context.dev (extraction), and **checked by Gemini vision** against the brand, name and pack size on the pack. It is **shown by linking to the source image**, never copied or re-hosted, with "source ↗". EU case law treats linking or embedding freely accessible content as no new communication to the public (Svensson C-466/12, BestWater C-348/13), unless that gets around the site's own blocking (VG Bild-Kunst C-392/19).
     3. **Pexels / Unsplash** dish photo, or a category icon.

     Every step records source, licence basis and verification status. Images behind the Valio login are excluded at every step.
   - **Cloudinary is a pipeline, not a source.** It can host and normalise whatever images we legitimately have (crop, background removal, consistent sizes). Its natural fit is the parked document flow (D7): a photographed delivery note or BEO, cropped next to the extracted fields.
   - **Never:** commit Valio or Synkka images, bulk-crawl the webshop or its media API, hotlink from behind the login, or present OFF photos as Valio's.
