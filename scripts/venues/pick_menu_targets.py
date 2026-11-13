"""Build data/venues/menu_targets.json: ~20 venues across profiles with a menu URL to scrape.

URLs come from two places, recorded per target as `url_source`:
  exa  the menu/banquet page Exa found (data/venues/exa_results.json), hand-checked to be on the venue's own site or a lunch portal
  exa2 a hotel restaurant page from Exa's second (hotel menu) round, fixed in PICKS
  links a menu link found on the hotel page by Context.dev's prebuilt `links` parser (scrape_menus.py --pdf-links)
  osm  the venue's website:menu / menu / lunch:menu tag in OSM
The picks are hand-chosen (a fixed list of names) so the set spans every profile; edit PICKS to change it.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VEN = ROOT / "data" / "venues"

PICKS = [  # (venue name in OSM, url source)
    ("Ravintola Mashiro", "exa"), ("Factory - Elimäenkatu", "exa"), ("Rauhankahvila Fredrika", "osm"),
    ("Ravintola Pisara Lauttasaari", "osm"),
    ("Don Corleone Italian Kitchen", "exa"), ("Tian Tian: Every Day dumplings", "exa"), ("Taulu", "osm"),
    ("The Bull & The Firm", "osm"),
    ("Palace", "exa"), ("Garden By Olo", "exa"),
    ("Hotel Helka", "exa"), ("The Folks Hotel Konepaja", "exa"), ("Hilton Helsinki Strand", "exa"),
    ("Cafe Regatta", "osm"), ("Hav A Java", "exa"),
    ("Edvin Pizza Napoletana", "osm"), ("Khao Gaeng Thai Street Food", "exa"),
    ("Rax Pizzabuffet", "exa"), ("Friends & Brgrs", "osm"),
    ("Ravintola Sisäpiha", "exa"), ("Ravintola Merta", "osm"),
    ("SalamaNation", "exa"), ("Merimies pub", "osm"),
    # Second round: hotel banquet pages gave no dishes, so hotel restaurant / Christmas pages found by Exa's hotel round.
    ("Hotel Helka", "exa2", "https://www.hotelhelka.com/fi/events/joululounas"),
    ("Hilton Helsinki Strand", "exa2", "https://www.hilton.com/en/hotels/helhihi-hilton-helsinki-strand/dining/"),
    ("The Folks Hotel Konepaja", "exa2", "https://folkshotels.fi/en/eat-drink"),
    ("Hotel Kämp", "exa2", "https://hotelkamp.com/food-drink/restaurant-ala-kamp"),
    ("Hotel Kämp", "links", "https://alakamp.fi/menu"),
    ("Scandic Kallio", "links", "https://www.scandichotels.com/fi/ravintolat/joululounas"),
    ("Scandic Kallio", "exa2", "https://www.scandichotels.fi/hotellit/suomi/helsinki/scandic-kallio/ravintola-ja-baari/ravintola"),
]


def main():
    venues = json.loads((VEN / "venues_classified.json").read_text(encoding="utf-8"))
    exa = {r["osm_id"]: r for r in json.loads((VEN / "exa_results.json").read_text(encoding="utf-8"))["venues"]}
    out = []
    for name, src, *fixed in PICKS:
        cands = [v for v in venues if (v["name"] or "").startswith(name)]
        if fixed:
            url = fixed[0]
        elif src == "exa":
            cands = [v for v in cands if v["osm_id"] in exa and exa[v["osm_id"]]["menu_url"]]
            url = exa[cands[0]["osm_id"]]["menu_url"] if cands else None
        else:
            cands = [v for v in cands if any(k in v["tags"] for k in ("website:menu", "menu", "lunch:menu"))
                     and (v["tags"].get("website:menu") or v["tags"].get("menu") or "").startswith("http")]
            url = (cands[0]["tags"].get("website:menu") or cands[0]["tags"].get("menu")) if cands else None
        if not url:
            print("no url for", name)
            continue
        v = cands[0]
        out.append({"osm_id": v["osm_id"], "name": v["name"], "profile": v["profile"], "city": v["city"],
                    "url": url, "url_source": src})
    (VEN / "menu_targets.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    for t in out:
        print(t["profile"], "|", t["name"], "|", t["url"])
    print(len(out), "targets")


if __name__ == "__main__":
    main()
