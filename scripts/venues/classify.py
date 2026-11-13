"""Classify OSM venues into kitchen profiles and estimate daily covers (a transparent heuristic).

Input:  data/venues/osm_venues.json
Output: data/venues/venues_classified.json (one row per venue: profile, reason, covers estimate)

Profiles (first rule that matches wins, the reason is stored per venue):
  canteen_public   amenity=canteen, or an institutional food-service operator (Compass, Sodexo, Amica, ...)
  hotel            tourism=hotel
  bar              amenity=bar|pub
  pizzeria_fast    amenity=fast_food, or cuisine pizza/burger/kebab
  cafe_bakery      amenity=cafe, or cuisine coffee_shop/bakery/cake
  fine_dining      cuisine fine_dining, or a name on the short Michelin/fine-dining list below
  lunch_restaurant restaurant that closes by 16:00 on weekdays, is weekday-only, or carries lunch tags
  a_la_carte       any other restaurant

Chains are an attribute, not a profile (as in docs/research/horeca-profiles.md): `central_list: true` when the venue
has a brand tag or a known chain name. `horeca_profile` maps each profile to that doc's P-codes:
  hotel -> P1, lunch_restaurant and canteen_public -> P2 (OSM's canteens are staff/student lunch places; public central
  kitchens, P3, are not in OSM), a_la_carte and fine_dining -> P4, cafe_bakery -> P6, pizzeria_fast and bar -> none.

Covers per day are ESTIMATED: seats (capacity/seats tag) x turns per day for the profile when seats are known,
otherwise a profile default, times a deterministic 0.75-1.25 jitter from the OSM id so venues differ.
Hotels with a rooms tag use rooms x 0.7 occupancy x 1.5 guests x 1.3 (breakfast plus restaurant share).
"""
import hashlib, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VEN = ROOT / "data" / "venues"

INSTITUTIONAL = re.compile(r"\b(compass|sodexo|amica|fazer food|juvenes|unicafe|palmia|semma|food & co|food&co|eurest)\b", re.I)
CHAINS = re.compile(r"\b(hesburger|mcdonald|burger king|subway|kotipizza|rolls|taco bell|o'learys|ravintola rax|rax buffet|"
                    r"robert'?s coffee|espresso house|starbucks|wayne'?s coffee|picnic|fafa'?s|friends & brgrs|friends and brgrs|"
                    r"pancho villa|amarillo|vapiano|chico'?s|hanko sushi|itsudemo|social burger|sushibar \+ wine|kfc|"
                    r"tortilla house|pizzarium|dennis|golden rax|presto|r-kioski|cafe picnic|arnolds)\b", re.I)
FINE = re.compile(r"^(palace|olo|ora|demo|grön|gron|inari|savoy|finnjävel|finnjavel|nokka|natura|garden by olo|"
                  r"restaurant palace|ravintola olo|ravintola savoy|ravintola nokka|ravintola demo|ravintola ora|ravintola natura|"
                  r"vinkkeli|ravintola grön)$", re.I)
FAST_CUISINE = re.compile(r"pizza|burger|kebab|hot_dog|sandwich|chicken|fries|falafel", re.I)
CAFE_CUISINE = re.compile(r"coffee_shop|bakery|cake|donut|ice_cream|pastry|tea", re.I)

HORECA = {"hotel": "P1", "lunch_restaurant": "P2", "canteen_public": "P2", "a_la_carte": "P4", "fine_dining": "P4",
          "cafe_bakery": "P6", "pizzeria_fast": None, "bar": None}


def chain(v):
    t = v["tags"]
    if t.get("brand") or t.get("brand:wikidata"):
        return f"brand={t.get('brand') or t.get('brand:wikidata')}"
    if CHAINS.search(v["name"] or ""):
        return "known chain name"
    return None


TURNS = {"lunch_restaurant": 1.6, "a_la_carte": 1.3, "fine_dining": 1.0, "cafe_bakery": 2.5, "pizzeria_fast": 3.0, "canteen_public": 1.5, "bar": 0.6, "hotel": 1.2}
DEFAULT = {"lunch_restaurant": 150, "a_la_carte": 90, "fine_dining": 40, "cafe_bakery": 110, "pizzeria_fast": 160, "canteen_public": 350, "bar": 40, "hotel": 220}


def lunch_like(t):
    oh = (t.get("opening_hours") or "").lower()
    if "lunch" in t or "lunch:menu" in t or re.search(r"\blounas\b", (t.get("description") or ""), re.I):
        return "lunch tag"
    closes = [int(h) for h in re.findall(r"-(\d{1,2}):\d{2}", oh)]
    if oh and closes and max(closes) <= 16 and max(closes) >= 12:
        return f"closes by {max(closes)}:00"
    if oh and re.fullmatch(r"\s*mo-fr [0-9:,\- ]+(; *(sa|su|ph).*off)*\s*", oh):
        return "weekday-only hours"
    return None


def classify(v):
    t, typ, name = v["tags"], v["osm_type"], v["name"] or ""
    cuisine = t.get("cuisine", "")
    op = " ".join([t.get("operator", ""), t.get("brand", "")])
    if typ == "canteen":
        return "canteen_public", "amenity=canteen"
    if INSTITUTIONAL.search(op) or INSTITUTIONAL.search(name):
        return "canteen_public", "institutional operator in name/operator"
    if typ == "hotel":
        return "hotel", "tourism=hotel"
    if typ in ("bar", "pub"):
        return "bar", f"amenity={typ}"
    if typ == "fast_food" or FAST_CUISINE.search(cuisine):
        return "pizzeria_fast", f"amenity={typ}" if typ == "fast_food" else f"cuisine={cuisine}"
    if typ == "cafe" or CAFE_CUISINE.search(cuisine):
        return "cafe_bakery", f"amenity={typ}" if typ == "cafe" else f"cuisine={cuisine}"
    if "fine_dining" in cuisine:
        return "fine_dining", "cuisine=fine_dining"
    if FINE.match(name.strip()):
        return "fine_dining", "name on fine-dining list (heuristic)"
    why = lunch_like(t)
    if why:
        return "lunch_restaurant", why
    return "a_la_carte", "restaurant, no lunch signal"


def num(x):
    m = re.match(r"\s*(\d+)", str(x or ""))
    return int(m.group(1)) if m else None


def covers(v, profile):
    t = v["tags"]
    jitter = 0.75 + (int(hashlib.sha256(v["osm_id"].encode()).hexdigest()[:8], 16) % 1000) / 2000
    seats = num(t.get("capacity")) or num(t.get("seats"))
    rooms = num(t.get("rooms"))
    if profile == "hotel" and rooms:
        return round(rooms * 0.7 * 1.5 * 1.3), f"rooms={rooms} x 0.7 occ x 1.5 guests x 1.3"
    if seats and profile != "hotel" and 4 <= seats <= 2000:
        return round(seats * TURNS[profile]), f"seats={seats} x {TURNS[profile]} turns"
    return round(DEFAULT[profile] * jitter), f"profile default {DEFAULT[profile]} x jitter {jitter:.2f}"


def main():
    src = json.loads((VEN / "osm_venues.json").read_text(encoding="utf-8"))
    out = []
    for v in src["venues"]:
        p, why = classify(v)
        c, how = covers(v, p)
        ch = chain(v)
        if ch and p not in ("hotel", "canteen_public"):  # chain outlets serve more covers than a lone venue
            c, how = round(c * 1.5), how + " x 1.5 chain"
        out.append({**v, "profile": p, "horeca_profile": HORECA[p], "profile_reason": why, "central_list": bool(ch),
                    "chain_reason": ch, "covers_per_day_est": c, "covers_method": how})
    (VEN / "venues_classified.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    from collections import Counter
    print(Counter(v["profile"] for v in out).most_common(), "chains", sum(v["central_list"] for v in out))
    print(Counter((v["city"], v["profile"]) for v in out).most_common())


if __name__ == "__main__":
    main()
