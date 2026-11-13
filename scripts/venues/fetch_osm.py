"""Fetch HoReCa venues in Helsinki, Espoo and Vantaa from OpenStreetMap (Overpass API).

One Overpass query per venue type (all three cities, split by marker elements), a pause between queries, and a generic User-Agent.
Raw responses are cached in data/venues/osm_raw/<type>.json; pass --refresh to refetch.
Output: data/venues/osm_venues.json (ODbL, (c) OpenStreetMap contributors).

Usage: python -I scripts/venues/fetch_osm.py [--refresh]
"""
import json, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "venues"
RAW = OUT / "osm_raw"
ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
UA = "junction-hackathon-venue-fetch/0.1 (research prototype)"
CITIES = ["Helsinki", "Espoo", "Vantaa"]
TYPES = {  # file key -> overpass selector
    "restaurant": '["amenity"="restaurant"]',
    "cafe": '["amenity"="cafe"]',
    "fast_food": '["amenity"="fast_food"]',
    "bar": '["amenity"="bar"]',
    "pub": '["amenity"="pub"]',
    "canteen": '["amenity"="canteen"]',
    "hotel": '["tourism"="hotel"]',
}
KEEP = ["cuisine", "opening_hours", "capacity", "seats", "operator", "brand", "brand:wikidata",
        "website", "contact:website", "url", "phone", "contact:phone", "email", "diet:vegan",
        "diet:vegetarian", "takeaway", "delivery", "outdoor_seating", "rooms", "beds", "stars",
        "wheelchair", "lunch", "lunch:menu", "website:menu", "menu", "description", "amenity", "tourism"]


def type_query(selector):
    """One query per type covering all three cities; a `make` marker element precedes each city's set."""
    parts = []
    for c in CITIES:
        parts.append(f'area["boundary"="administrative"]["admin_level"="8"]["name"="{c}"]->.a;'
                     f'make marker city="{c}";out;nwr{selector}(area.a);out center tags;')
    return "[out:json][timeout:180];" + "".join(parts)


def fetch(q):
    """Try each public endpoint once (no retry storm); raise the last error if all fail."""
    data = urllib.parse.urlencode({"data": q}).encode()
    err = None
    for ep in ENDPOINTS:
        try:
            req = urllib.request.Request(ep, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=200) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # 429/502/504 from a busy instance: move to the next one
            print(f"  {ep}: {e}")
            err = e
            time.sleep(10)
    raise err


def norm(el, osm_type, city):
    t = el.get("tags", {})
    lat = el.get("lat") or (el.get("center") or {}).get("lat")
    lon = el.get("lon") or (el.get("center") or {}).get("lon")
    addr = {k[5:]: v for k, v in t.items() if k.startswith("addr:")}
    street = " ".join(x for x in [addr.get("street"), addr.get("housenumber")] if x)
    return {
        "osm_id": f"{el['type']}/{el['id']}",
        "osm_type": osm_type,
        "name": t.get("name"),
        "lat": lat, "lon": lon,
        "city": city,
        "address": ", ".join(x for x in [street, " ".join(y for y in [addr.get("postcode"), addr.get("city")] if y)] if x) or None,
        "tags": {k: t[k] for k in KEEP if k in t},
    }


def main():
    refresh = "--refresh" in sys.argv
    RAW.mkdir(parents=True, exist_ok=True)
    venues, seen, stats = [], set(), {}
    for key, sel in TYPES.items():
        f = RAW / f"{key}.json"
        if f.exists() and not refresh:
            raw = json.loads(f.read_text(encoding="utf-8"))
        else:
            t0 = time.time()
            raw = fetch(type_query(sel))
            f.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
            print(f"fetched {key}: {len(raw.get('elements', []))} elements in {time.time()-t0:.1f}s")
            time.sleep(5)  # be polite to the public Overpass instance
        city = None
        for el in raw.get("elements", []):
            if el.get("type") == "marker":
                city = el["tags"]["city"]
                continue
            oid = f"{el['type']}/{el['id']}"
            if oid in seen:
                continue
            seen.add(oid)
            venues.append(norm(el, key, city))
            stats[f"{key}/{city}"] = stats.get(f"{key}/{city}", 0) + 1
    named = [v for v in venues if v["name"]]
    doc = {
        "source": "OpenStreetMap via Overpass API",
        "licence": "ODbL 1.0",
        "attribution": "Venue data (c) OpenStreetMap contributors, available under the Open Database License (ODbL).",
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "cities": CITIES,
        "counts": stats,
        "n": len(named),
        "n_unnamed_dropped": len(venues) - len(named),
        "venues": named,
    }
    (OUT / "osm_venues.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(stats, indent=1), "\nnamed venues:", len(named), "unnamed dropped:", len(venues) - len(named))


if __name__ == "__main__":
    main()
