"""Profile the Valio Aimo product data files (static data only, no API calls).

Run from the repo root:
    PYTHONIOENCODING=utf-8 python -I scripts/probe/valio_profile.py

Reads data/valio/*.json|csv. Writes:
  docs/foundations/valio-profile.json  aggregates only (committable)
  data/valio/probe/sample.json          200 raw products for fixtures (gitignored, Valio's data)
  data/valio/probe/heroes.json          candidate demo products (gitignored)
"""
import csv, json, random, re, statistics as st, sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
D = ROOT / "data" / "valio"
OUT_PROBE = D / "probe"
OUT_PROFILE = ROOT / "docs" / "foundations" / "valio-profile.json"
OUT_PROBE.mkdir(parents=True, exist_ok=True)

products = json.load(open(D / "valio_aimo_junction26_product_data.json", encoding="utf-8"))
N = len(products)
carbon = {}
with open(D / "valio_aimo_junction26_carbon_footprint.csv", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        carbon[r["productId"]] = float(r["AVG kg CO2-eq/kg"])
rel = {}
with open(D / "valio_aimo_junction26_delivery_reliability.csv", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        rel[r["productId"]] = float(r["deliveryReliability"])


def pct(n, d=N):
    return round(100 * n / d, 1) if d else 0


def pcts(vals, ps=(0, 5, 25, 50, 75, 95, 100)):
    if not vals:
        return {}
    v = sorted(vals)
    return {f"p{p}": round(v[min(len(v) - 1, int(p / 100 * (len(v) - 1)))], 4) for p in ps}


def nonempty(v):
    return v not in (None, "", [], {})


def name(p, lang="fi"):
    for n in (p.get("synkkaData") or {}).get("names") or []:
        if n.get("language") == lang and n.get("value"):
            return n["value"]
    return None


def any_name(p):
    return name(p, "fi") or name(p, "en") or name(p, "sv")


prof = {"generatedFrom": "data/valio product_data.json + carbon/reliability CSVs", "products": N}

# ---------- field fill rates ----------
top = Counter(); top_types = defaultdict(Counter); syn = Counter(); syn_types = defaultdict(Counter)
for p in products:
    for k, v in p.items():
        top_types[k][type(v).__name__] += 1
        if nonempty(v):
            top[k] += 1
    s = p.get("synkkaData") or {}
    for k, v in s.items():
        syn_types[k][type(v).__name__] += 1
        if nonempty(v):
            syn[k] += 1
prof["topLevelFill"] = {k: {"pct": pct(top[k]), "types": dict(top_types[k])} for k in sorted(top_types)}
prof["synkkaFill"] = {k: {"pct": pct(syn[k]), "types": dict(syn_types[k])} for k in sorted(syn_types, key=lambda k: -syn[k])}

# ---------- categories, vendors, origin, temperature ----------
cat = Counter(p.get("category") for p in products)
prof["categories"] = {
    "distinct": len(cat),
    "codeLengths": dict(Counter(len(c or "") for c in cat)),
    "top30": cat.most_common(30),
    "byPrefix2": Counter((c or "")[:2] for c in (p.get("category") for p in products)).most_common(40),
    "byPrefix3": len(Counter((c or "")[:3] for c in (p.get("category") for p in products))),
    "sizeDistribution": pcts(list(cat.values())),
    "singletons": sum(1 for v in cat.values() if v == 1),
}
_brandish = Counter()
for p in products:
    for w in re.findall(r"[a-zåäö]+", ((p.get("synkkaData") or {}).get("brand") or "").lower() + " " + (p.get("vendorName") or "").lower()):
        _brandish[w] += 1
STOP = set(_brandish) | {"kg", "pcs", "with", "for", "and", "the", "about", "pce", "ltk", "vak"}


def label_words(ps, k=5):
    c = Counter()
    for p in ps:
        for w in set(re.findall(r"[a-zåäö]{3,}", (name(p, "en") or "").lower())):
            if w not in STOP:
                c[w] += 1
    return [w for w, _ in c.most_common(k)]


# (legacy) most common first word of fi names: mostly brands, kept only for the top-30 list
cat_words = defaultdict(Counter)
for p in products:
    nm = name(p, "fi") or name(p, "en")
    if nm:
        w = re.split(r"[\s,]+", nm.strip())[0].lower()
        cat_words[p.get("category")][w] += 1
prof["categories"]["top30WithNameHints"] = [(c, n, label_words([p for p in products if p.get("category") == c], 4)) for c, n in cat.most_common(30)]
vend = Counter(p.get("vendorName") for p in products)
prof["vendors"] = {"distinct": len(vend), "top20": vend.most_common(20)}
coo = Counter(p.get("countryOfOrigin") for p in products)
prof["countryOfOrigin"] = {"distinct": len(coo), "top20": coo.most_common(20), "missing": coo.get(None, 0) + coo.get("", 0)}
syn_coo = Counter()
mismatch = 0
for p in products:
    cs = (p.get("synkkaData") or {}).get("countriesOfOrigin") or []
    for c in cs:
        syn_coo[c] += 1
    if p.get("countryOfOrigin") == "fi" and cs and "246" not in cs:
        mismatch += 1
prof["synkkaCountriesOfOrigin"] = {"top10": syn_coo.most_common(10), "fiTopLevelButSynkkaNot246": mismatch}
temp = Counter(p.get("temperatureCondition") for p in products)
# infer meaning of temperature codes from min/max temperature
tmin = defaultdict(list); tmax = defaultdict(list)
for p in products:
    s = p.get("synkkaData") or {}
    if s.get("maxTemperature") is not None:
        tmax[p.get("temperatureCondition")].append(s["maxTemperature"])
    if s.get("minTemperature") is not None:
        tmin[p.get("temperatureCondition")].append(s["minTemperature"])
prof["temperatureCondition"] = {
    str(k): {"n": v, "medianMinC": st.median(tmin[k]) if tmin[k] else None, "medianMaxC": st.median(tmax[k]) if tmax[k] else None,
             "nameWords": label_words([p for p in products if p.get("temperatureCondition") == k], 6)}
    for k, v in temp.most_common()
}
prof["deleted"] = dict(Counter(str(p.get("deleted")) for p in products))

# ---------- units ----------
prof["salesUnit"] = Counter(p.get("salesUnit") for p in products).most_common()
prof["baseUnit"] = Counter(p.get("baseUnit") for p in products).most_common()
prof["salesEqBase"] = pct(sum(1 for p in products if p.get("salesUnit") == p.get("baseUnit")))
uid = Counter(); size_by = defaultdict(list); nunits = Counter()
sales_in_units = 0
for p in products:
    us = p.get("units") or []
    nunits[len(us)] += 1
    for u in us:
        uid[u.get("unitId")] += 1
        if u.get("sizeInBaseUnits") is not None:
            size_by[u.get("unitId")].append(u["sizeInBaseUnits"])
    if any(u.get("unitId") == p.get("salesUnit") for u in us):
        sales_in_units += 1
prof["units"] = {
    "unitIdCounts": uid.most_common(),
    "sizeInBaseUnitsByUnit": {k: pcts(v) for k, v in size_by.items()},
    "unitsPerProduct": dict(sorted(nunits.items())),
    "salesUnitPresentInUnitsPct": pct(sales_in_units),
}
prof["allowedLotSize"] = Counter(p.get("allowedLotSize") for p in products).most_common(15)
prof["lotSizeBySalesUnit"] = {
    su: Counter(p.get("allowedLotSize") for p in products if p.get("salesUnit") == su).most_common(5)
    for su, _ in prof["salesUnit"][:8]
}

# ---------- net weight / unitConversions ----------
pk = Counter(); has_net_base = 0; has_net_any = 0; has_vol = 0
for p in products:
    ucs = (p.get("synkkaData") or {}).get("unitConversions") or []
    anyn = False
    for uc in ucs:
        pk[uc.get("synkkaPackagingType")] += 1
        if (uc.get("netWeight") or {}).get("value"):
            anyn = True
            if uc.get("synkkaPackagingType") == "BASE_UNIT_OR_EACH":
                has_net_base += 1
        if (uc.get("volume") or {}).get("value"):
            has_vol += 1
    has_net_any += anyn
prof["unitConversions"] = {"packagingTypes": pk.most_common(), "netWeightAnyPct": pct(has_net_any),
                           "netWeightBaseUnitPct": pct(has_net_base)}
prof["variableUnit"] = dict(Counter(str((p.get("synkkaData") or {}).get("variableUnit")) for p in products))
prof["vatCode"] = dict(Counter(str((p.get("synkkaData") or {}).get("vatCode")) for p in products))

# ---------- names / texts ----------
langfill = {}
for field in ("names", "marketingTexts", "storageInstructions", "usageInstructions", "preparationInstructions",
              "keyIngredients", "materialAdditionalDescriptions", "disposalInformations"):
    c = Counter()
    for p in products:
        for t in (p.get("synkkaData") or {}).get(field) or []:
            if t.get("value"):
                c[t.get("language")] += 1
    # count products per language (dedupe)
    cp = Counter()
    for p in products:
        langs = {t.get("language") for t in (p.get("synkkaData") or {}).get(field) or [] if t.get("value")}
        for l in langs:
            cp[l] += 1
    langfill[field] = {l: pct(n) for l, n in cp.most_common(6)}
prof["textFillByLanguagePct"] = langfill
prof["noNameAtAll"] = sum(1 for p in products if not any_name(p))
prof["nameUppercaseShare"] = pct(sum(1 for p in products if (name(p) or "").isupper()))
# reject flags in names
flags = Counter()
for p in products:
    nm = (name(p) or "") + " " + (name(p, "en") or "")
    for w in ("HYLÄÄ", "POISTO", "EI KÄYTÖSSÄ", "VANHA", "ÄLÄ"):
        if w in nm.upper():
            flags[w] += 1
prof["nameFlags"] = dict(flags)

# ---------- classifications / ingredients / nutrition ----------
cls = Counter(); allergen_units = Counter(); allergen_ids = Counter()
for p in products:
    s = p.get("synkkaData") or {}
    names_here = set()
    for g in s.get("classifications") or []:
        if g.get("values"):
            names_here.add(g.get("name"))
        if g.get("name") == "allergen":
            for v in g.get("values") or []:
                allergen_units[v.get("unit")] += 1
                allergen_ids[v.get("synkkaId") or v.get("id")] += 1
    for n in names_here:
        cls[n] += 1
prof["classificationGroupsPct"] = {k: pct(v) for k, v in cls.most_common()}
prof["allergenUnits"] = allergen_units.most_common()
prof["allergenIdsTop20"] = allergen_ids.most_common(20)
label_ids = Counter()
for p in products:
    for g in (p.get("synkkaData") or {}).get("classifications") or []:
        if g.get("name") in ("packagingMarkedLabel", "nutritionalClaim"):
            for v in g.get("values") or []:
                label_ids[(g.get("name"), v.get("synkkaId") or v.get("id"))] += 1
prof["labelsAndClaimsTop25"] = [[a, b, n] for (a, b), n in label_ids.most_common(25)]
nut_ids = Counter()
for p in products:
    for n in (p.get("synkkaData") or {}).get("nutritionalContent") or []:
        nut_ids[n.get("id")] += 1
prof["nutrientIdsTop15"] = nut_ids.most_common(15)
ing_origin = sum(1 for p in products if any(i.get("origins") for i in (p.get("synkkaData") or {}).get("ingredients") or []))
prof["ingredientsWithOriginPct"] = pct(ing_origin)
fish = Counter()
for p in products:
    for fr in (p.get("synkkaData") or {}).get("fishingReports") or []:
        fish[fr.get("id")] += 1
prof["fishSpeciesTop15"] = fish.most_common(15)

# ---------- media ----------
media_n = Counter(len((p.get("synkkaData") or {}).get("medias") or []) for p in products)
prof["medias"] = {"countsPerProduct": dict(sorted(media_n.items())[:12]),
                  "withAnyPct": pct(sum(v for k, v in media_n.items() if k > 0)),
                  "withPrimaryPct": pct(sum(1 for p in products if any(m.get("primary") for m in (p.get("synkkaData") or {}).get("medias") or []))),
                  "exampleObjects": [m for p in products[:50] for m in ((p.get("synkkaData") or {}).get("medias") or [])][:3]}
media_keys = Counter()
for p in products:
    for m in (p.get("synkkaData") or {}).get("medias") or []:
        for k in m:
            media_keys[k] += 1
prof["medias"]["keys"] = dict(media_keys)

# ---------- deposits, substitutions ----------
dep = Counter(); dep_mat = Counter()
for p in products:
    ds = p.get("deposits") or []
    dep[len(ds) > 0] += 1
    for d in ds:
        dep_mat[d.get("material")] += 1
prof["deposits"] = {"withAnyPct": pct(dep[True]), "materialsTop10": dep_mat.most_common(10)}
ids = {p["id"] for p in products}
subs = []
for p in products:
    for s in p.get("substitutions") or []:
        subs.append((p["id"], s.get("product"), s.get("substituteProduct")))
sub_products = {a for a, _, _ in subs}
sub_targets = [c for _, _, c in subs]
pcat = {p["id"]: p.get("category") for p in products}
prof["substitutions"] = {
    "productsWithAny": len(sub_products), "productsWithAnyPct": pct(len(sub_products)), "rules": len(subs),
    "perProduct": pcts([sum(1 for a, _, _ in subs if a == x) for x in sub_products]) if len(sub_products) < 5000 else None,
    "selfProductFieldMatchesId": pct(sum(1 for a, b, _ in subs if a == b), len(subs)),
    "targetsInCatalogPct": pct(sum(1 for c in sub_targets if c in ids), len(subs)),
    "sameCategoryPct": pct(sum(1 for a, _, c in subs if pcat.get(a) == pcat.get(c)), len(subs)),
    "targetCarbonPct": pct(sum(1 for c in sub_targets if c in carbon), len(subs)),
}

# ---------- ids, duplicates ----------
idc = Counter(p["id"] for p in products)
gt = Counter(p.get("salesUnitGtin") for p in products if p.get("salesUnitGtin"))
nm_dup = Counter((name(p) or "").strip().lower() for p in products if name(p))
prof["ids"] = {"duplicateIds": sum(1 for v in idc.values() if v > 1), "idRange": [min(idc), max(idc)],
               "idNumericPct": pct(sum(1 for i in idc if i.isdigit())),
               "salesUnitGtinPct": pct(sum(1 for p in products if p.get("salesUnitGtin"))),
               "duplicateSalesGtins": sum(1 for v in gt.values() if v > 1),
               "duplicateFiNames": sum(1 for v in nm_dup.values() if v > 1),
               "productsSharingFiName": sum(v for v in nm_dup.values() if v > 1)}

# ---------- name size vs net weight contradictions ----------
SIZE = re.compile(r"(?:(\d+)\s*[xX×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|l|dl|cl|ml)\b", re.I)
mult = {"kg": 1000, "g": 1, "l": 1000, "dl": 100, "cl": 10, "ml": 1}
contra = []; checked = 0; parsed = 0
for p in products:
    nm = name(p) or name(p, "en") or ""
    m = SIZE.search(nm)
    if m:
        parsed += 1
    base_net = None
    for uc in (p.get("synkkaData") or {}).get("unitConversions") or []:
        if uc.get("synkkaPackagingType") == "BASE_UNIT_OR_EACH" and (uc.get("netWeight") or {}).get("value"):
            nw = uc["netWeight"]; base_net = nw["value"] * (1000 if nw.get("unit") == "KGM" else 1)
    if m and base_net and m.group(3).lower() in ("kg", "g"):
        checked += 1
        k = int(m.group(1)) if m.group(1) else 1
        g = float(m.group(2).replace(",", ".")) * mult[m.group(3).lower()]
        if not (0.8 <= base_net / g <= 1.25 or 0.8 <= base_net / (g * k) <= 1.25):
            contra.append((p["id"], nm, p.get("baseUnit"), base_net))
prof["sizeInNamePct"] = pct(parsed)
prof["nameVsNetWeight"] = {"checked": checked, "contradictions": len(contra), "contradictionPct": pct(len(contra), checked),
                           "exampleIds": [c[0] for c in contra[:8]]}
json.dump(contra, open(OUT_PROBE / "name_vs_netweight.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
# can we get a weight/volume per sales unit at all? (base netWeight, size in name, or sold by KG)
prof["weightResolvablePct"] = pct(sum(1 for p in products if p.get("salesUnit") == "KG" or SIZE.search(name(p) or name(p, "en") or "")
    or any((uc.get("netWeight") or {}).get("value") for uc in (p.get("synkkaData") or {}).get("unitConversions") or [])))

# ---------- joins ----------
cset, rset = set(carbon), set(rel)
prof["joins"] = {
    "carbonRows": len(carbon), "carbonInCatalog": len(cset & ids), "carbonCatalogPct": pct(len(cset & ids)),
    "reliabilityRows": len(rel), "reliabilityInCatalog": len(rset & ids), "reliabilityCatalogPct": pct(len(rset & ids)),
    "all3": len(cset & rset & ids), "reliabilityWithoutCarbon": len((rset - cset) & ids),
    "carbonDistinctValues": len(set(carbon.values())),
    "carbonPercentiles": pcts(list(carbon.values())),
    "reliabilityPercentiles": pcts(list(rel.values()), (0, 1, 5, 10, 25, 50, 75, 100)),
    "reliabilityEq1Pct": pct(sum(1 for v in rel.values() if v == 1.0), len(rel)),
    "reliabilityLt09Pct": pct(sum(1 for v in rel.values() if v < 0.9), len(rel)),
    "reliabilityLt07": sum(1 for v in rel.values() if v < 0.7),
}
# is carbon constant within category? (portal says it's a product-group average)
by_cat = defaultdict(set); by_cat_vals = defaultdict(list)
for i, v in carbon.items():
    by_cat[pcat.get(i)].add(v); by_cat_vals[pcat.get(i)].append(v)
prof["joins"]["categoriesWithCarbon"] = len(by_cat)
prof["joins"]["categoriesWithSingleCarbonValuePct"] = pct(sum(1 for s in by_cat.values() if len(s) == 1), len(by_cat))
cat_cov = {c: sum(1 for p in products if p.get("category") == c and p["id"] in carbon) for c, _ in cat.most_common(400)}
prof["joins"]["categoriesFullyCoveredByCarbonPct"] = pct(sum(1 for c in cat_cov if cat_cov[c] == cat[c]), len(cat_cov))
prof["joins"]["categoriesPartlyCovered"] = sum(1 for c in cat_cov if 0 < cat_cov[c] < cat[c])
# carbon by temperature class (proxy for category groups)
ct = defaultdict(list)
for p in products:
    if p["id"] in carbon:
        ct[p.get("temperatureCondition")].append(carbon[p["id"]])
prof["joins"]["carbonByTemperature"] = {str(k): pcts(v, (5, 50, 95)) for k, v in ct.items()}
# carbon per top categories
prof["joins"]["carbonByPrefix2"] = {
    k: {"n": sum(1 for p in products if p.get("category", "")[:2] == k),
        "carbon": pcts([carbon[p["id"]] for p in products if p.get("category", "")[:2] == k and p["id"] in carbon], (5, 50, 95)),
        "carbonCovPct": pct(sum(1 for p in products if p.get("category", "")[:2] == k and p["id"] in carbon), max(1, sum(1 for p in products if p.get("category", "")[:2] == k))),
        "reliabilityCovPct": pct(sum(1 for p in products if p.get("category", "")[:2] == k and p["id"] in rel), max(1, sum(1 for p in products if p.get("category", "")[:2] == k))),
        "words": label_words([p for p in products if p.get("category", "")[:2] == k], 7)}
    for k, _ in prof["categories"]["byPrefix2"]}
prof["categoryLabelHints"] = {c: {"n": n, "words": label_words([p for p in products if p.get("category") == c], 5),
                                  "carbonValues": sorted(by_cat[c])[:4] if c in by_cat else []} for c, n in cat.most_common()}

# ---------- heroes ----------
def hero_search(pattern, limit=12, langs=("fi", "en")):
    rx = re.compile(pattern, re.I)
    hits = []
    for p in products:
        txt = " | ".join(filter(None, (name(p, l) for l in langs)))
        if rx.search(txt):
            net = None
            for uc in (p.get("synkkaData") or {}).get("unitConversions") or []:
                if uc.get("synkkaPackagingType") == "BASE_UNIT_OR_EACH" and (uc.get("netWeight") or {}).get("value"):
                    net = f'{uc["netWeight"]["value"]} {uc["netWeight"].get("unit")}'
            hits.append({"id": p["id"], "fi": name(p), "en": name(p, "en"), "cat": p.get("category"), "vendor": p.get("vendorName"),
                         "origin": p.get("countryOfOrigin"), "temp": p.get("temperatureCondition"), "salesUnit": p.get("salesUnit"),
                         "baseUnit": p.get("baseUnit"), "lot": p.get("allowedLotSize"),
                         "units": [(u.get("unitId"), u.get("sizeInBaseUnits")) for u in p.get("units") or []],
                         "netBase": net, "co2": carbon.get(p["id"]), "rel": rel.get(p["id"]),
                         "subs": [s.get("substituteProduct") for s in p.get("substitutions") or []],
                         "media": len((p.get("synkkaData") or {}).get("medias") or [])})
    hits.sort(key=lambda h: (h["co2"] is None, h["rel"] is None, len(h["fi"] or "")))
    return {"matches": len(hits), "top": hits[:limit]}

heroes = {
    "lactoseFreeMilk": hero_search(r"(laktoositon|lactose.?free).*(maito|maitojuoma|milk)|(maito|milk).*(laktoositon|lactose.?free)|^valio.*\bla\b|eila.*maito"),
    "salmon": hero_search(r"\blohi|lohifil|salmon"),
    "rainbowTrout": hero_search(r"kirjolohi|rainbow trout"),
    "hamChristmas": hero_search(r"joulukinkku|kinkku.*(kyps|savu|grill)|christmas ham"),
    "herring": hero_search(r"(?<!u)silli|silakka|herring"),
    "butter": hero_search(r"^valio.*voi\b|\bvoi \d|butter"),
    "potato": hero_search(r"peruna|potato"),
    "cream": hero_search(r"kerma|cream"),
    "oatDrink": hero_search(r"kaurajuoma|oat drink|oatly"),
    "beefMince": hero_search(r"jauheliha|minced beef|ground beef"),
    "lanttulaatikko": hero_search(r"lanttulaatikko|porkkanalaatikko|rosolli"),
}
json.dump(heroes, open(OUT_PROBE / "heroes.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
prof["heroMatchCounts"] = {k: v["matches"] for k, v in heroes.items()}

# ---------- sample (200, stratified-ish, seeded) ----------
random.seed(42)
rich = [p for p in products if p["id"] in carbon and p["id"] in rel]
picked = {}
hero_ids = [h["id"] for v in heroes.values() for h in v["top"][:4]]
for i in hero_ids:
    picked[i] = None
for p in random.sample(rich, 80):
    picked[p["id"]] = None
for p in random.sample(products, 200):
    if len(picked) >= 200:
        break
    picked[p["id"]] = None
# include substitute targets of picked items where possible (keeps fixture closed under substitution)
byid = {p["id"]: p for p in products}
sample = [byid[i] for i in list(picked)[:200]]
json.dump(sample, open(OUT_PROBE / "sample.json", "w", encoding="utf-8"), ensure_ascii=False)
json.dump([p["id"] for p in sample], open(OUT_PROBE / "sample_ids.json", "w", encoding="utf-8"))
prof["sample"] = {"path": "data/valio/probe/sample.json", "n": len(sample), "seed": 42,
                  "composition": "hero candidates (top 4 per query) + 80 random with carbon+reliability + random fill"}

# merge with API findings if present (written by valio_probe.py api)
api_path = OUT_PROBE / "api_findings.json"
if api_path.exists():
    def _clean(x):  # aggregates only: drop example rows, keep header names not values
        if isinstance(x, dict):
            return {k: (sorted(v) if k.lower().endswith("headers") and isinstance(v, dict) else _clean(v))
                    for k, v in x.items() if not k.startswith("example") and k != "rows"}
        return [_clean(v) for v in x] if isinstance(x, list) else (x[:200] if isinstance(x, str) else x)
    prof["api"] = _clean(json.load(open(api_path, encoding="utf-8")))

OUT_PROFILE.parent.mkdir(parents=True, exist_ok=True)
json.dump(prof, open(OUT_PROFILE, "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=str)
print("wrote", OUT_PROFILE, "and", OUT_PROBE)
