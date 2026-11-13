"""Join OSM venues, the profile classification, Exa results and Context.dev menus into one file.

Inputs:  data/venues/venues_classified.json, data/venues/exa_results.json, data/venues/menus/index.json
Output:  data/venues/venues_enriched.json

Every venue carries `sources` naming where each field came from (osm, exa, context.dev, heuristic).
These are real public venues used as SIMULATED customers: nothing here says they buy from Valio.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VEN = ROOT / "data" / "venues"
LABEL = "Simulated customers; real public venue data (OpenStreetMap, Exa, Context.dev). Not Valio customers."
DEMO = {  # three demo kitchens, one per story the pitch tells (see docs/research/venues.md); keyed by OSM id
    "node/609212944": "hotel: Christmas buffet for 140 (Scandic's joululounas menu, 108 dishes)",
    "node/4210384605": "lunch restaurant: weekly lunch list, +80 covers on Friday",
    "node/10030372540": "a la carte: menu x covers, salmon out of stock",
}


def load(p, default):
    f = VEN / p
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else default


def main():
    venues = load("venues_classified.json", [])
    exa = {r["osm_id"]: r for r in load("exa_results.json", {"venues": []})["venues"]}
    menus = {s["osm_id"]: s for s in load("menus/index.json", {"scrapes": []})["scrapes"] if s.get("ok")}
    out = []
    for v in venues:
        t = v["tags"]
        site = t.get("website") or t.get("contact:website") or t.get("url")
        e, m = exa.get(v["osm_id"]), menus.get(v["osm_id"])
        src = {"name": "osm", "location": "osm", "address": "osm" if v["address"] else None,
               "cuisine": "osm" if t.get("cuisine") else None,
               "opening_hours": "osm" if t.get("opening_hours") else None,
               "profile": "heuristic (OSM tags)", "covers_per_day_est": "heuristic"}
        if site:
            src["website"] = "osm"
        elif e and e.get("discovered_website"):
            site, src["website"] = e["discovered_website"], "exa (unverified)"
        menu_url = t.get("website:menu") or t.get("menu") or (t.get("lunch:menu") if str(t.get("lunch:menu", "")).startswith("http") else None)
        if menu_url:
            src["menu_url"] = "osm"
        elif e and e.get("menu_url"):
            menu_url, src["menu_url"] = e["menu_url"], "exa (unverified)"
        if m:
            menu_url, src["menu_url"] = m["url"], src.get("menu_url") or "exa"
            src["menu"] = "context.dev"
        if e and e.get("banquet_url"):
            src["banquet_url"] = "exa (unverified)"
        out.append({
            "id": v["osm_id"].replace("/", "_"), "osm_id": v["osm_id"], "name": v["name"],
            "profile": v["profile"], "horeca_profile": v["horeca_profile"], "profile_reason": v["profile_reason"],
            "central_list": v["central_list"], "chain_reason": v["chain_reason"],
            "city": v["city"], "lat": v["lat"], "lon": v["lon"], "address": v["address"],
            "website": site, "cuisine": t.get("cuisine"), "opening_hours": t.get("opening_hours"),
            "brand": t.get("brand"), "operator": t.get("operator"),
            "covers_per_day_est": v["covers_per_day_est"], "covers_estimated": True, "covers_method": v["covers_method"],
            "menu_url": menu_url, "banquet_url": (e or {}).get("banquet_url"),
            "menu_id": m.get("menu_id") if m else None, "menu_dishes": m.get("n_dishes") if m else None,
            "demo_role": DEMO.get(v["osm_id"]),
            "sources": {k: s for k, s in src.items() if s},
        })
    doc = {"label": LABEL,
           "attribution": "Venue data (c) OpenStreetMap contributors, ODbL 1.0. Menus extracted with Context.dev; pages found with Exa.",
           "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "n": len(out), "venues": out}
    (VEN / "venues_enriched.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(out)} venues; with menu {sum(1 for x in out if x['menu_id'])}; with menu_url {sum(1 for x in out if x['menu_url'])}; "
          f"demo {[x['name'] for x in out if x['demo_role']]}")


if __name__ == "__main__":
    main()
