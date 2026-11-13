"""Use Exa search to find what OSM lacks for a sample of venues: menu / lunch-menu pages, hotel banquet pages,
and the website itself when OSM has none. Also runs one "find companies" style query.

Reads EXA_API_KEY from the environment (never written anywhere). Every response is cached in
data/venues/menus/exa/<sha>.json, so a rerun costs nothing; pass --refresh to refetch.
Input:  data/venues/venues_classified.json
Output: data/venues/exa_results.json (per venue: query, top results, picked menu URL; plus cost totals)

Usage: EXA_API_KEY=... python -I scripts/venues/enrich_exa.py [--n 30]
"""
import hashlib, json, os, sys, time, urllib.request
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
VEN = ROOT / "data" / "venues"
CACHE = VEN / "menus" / "exa"
API = "https://api.exa.ai/search"
MENU_WORDS = ("menu", "ruokalista", "lounas", "lunch", "a-la-carte", "alacarte", "carte", "meny", "food", "ruoka")
BANQUET_WORDS = ("banquet", "juhla", "kokous", "meeting", "event", "tilaisuu", "catering", "pikkujoulu", "christmas", "joulu")

# Sample size per profile (sums to 30); venues with a website are preferred, two per profile without one.
PER_PROFILE = {"lunch_restaurant": 5, "a_la_carte": 5, "fine_dining": 3, "hotel": 5, "cafe_bakery": 3,
               "pizzeria_fast": 3, "chain": 2, "canteen_public": 2, "bar": 2}


EXTRA = [  # (venue, query, domain)
    ("Hotel Helka", "Hotel Helka ravintola Helka pikkujoulu menu", "hotelhelka.com"),
    ("Hilton Helsinki Strand", "Hilton Helsinki Strand restaurant Bridges menu", "hilton.com"),
    ("The Folks Hotel Konepaja", "Folks Konepaja restaurant menu", "folkshotels.fi"),
    ("Hotel Kämp", "Hotel Kämp restaurant Brasserie Kämp menu", "hotelkamp.com"),
    ("Scandic", "Scandic Helsinki hotel restaurant menu", "scandichotels.fi"),
]


def website(v):
    t = v["tags"]
    return t.get("website") or t.get("contact:website") or t.get("url")


def exa(body, refresh=False):
    key = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:20]
    f = CACHE / f"{key}.json"
    if f.exists() and not refresh:
        return json.loads(f.read_text(encoding="utf-8")), True
    req = urllib.request.Request(API, data=json.dumps(body).encode(), method="POST", headers={
        "x-api-key": os.environ["EXA_API_KEY"], "Content-Type": "application/json",
        "User-Agent": "junction-hackathon-venue-enrich/0.1"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        data = {"error": e.code, "body": e.read().decode("utf-8", "replace")[:500]}
    data["_latency_s"] = round(time.time() - t0, 2)
    data["_request"] = body
    f.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    time.sleep(0.5)
    return data, False


def pick(results, words):
    for r in results:
        u = r.get("url", "").lower()
        if any(w in u for w in words):
            return r["url"]
    for r in results:
        txt = (r.get("title", "") + " " + " ".join(r.get("highlights") or [])).lower()
        if any(w in txt for w in words):
            return r["url"]
    return None


def sample(venues, n_total):
    by = defaultdict(list)
    for v in sorted(venues, key=lambda v: v["osm_id"]):
        # Chains are sampled as their own group (central_list), as in the recorded run.
        by["chain" if v.get("central_list") and v["profile"] not in ("hotel", "canteen_public") else v["profile"]].append(v)
    chosen = []
    for p, k in PER_PROFILE.items():
        with_site = [v for v in by[p] if website(v)]
        without = [v for v in by[p] if not website(v)]
        n_without = 1 if k >= 3 else 0
        step = max(1, len(with_site) // max(1, k))
        chosen += with_site[::step][: k - n_without] + without[:: max(1, len(without) // 2 or 1)][:n_without]
    return chosen[:n_total]


def main():
    refresh = "--refresh" in sys.argv
    n = int(sys.argv[sys.argv.index("--n") + 1]) if "--n" in sys.argv else 30
    CACHE.mkdir(parents=True, exist_ok=True)
    venues = json.loads((VEN / "venues_classified.json").read_text(encoding="utf-8"))
    rows, cost, calls, cached, lat = [], 0.0, 0, 0, []
    for v in sample(venues, n):
        site = website(v)
        hotel = v["profile"] == "hotel"
        q = (f"{v['name']} {v['city']} banquet meetings events catering" if hotel
             else f"{v['name']} {v['city']} {'lounas lunch menu' if v['profile'] in ('lunch_restaurant', 'canteen_public') else 'menu ruokalista'}")
        body = {"query": q, "type": "auto", "numResults": 5,
                "contents": {"highlights": {"numSentences": 2, "highlightsPerUrl": 1}}}
        if site:
            body["includeDomains"] = [urlparse(site if "//" in site else "https://" + site).netloc.removeprefix("www.")]
        data, hit = exa(body, refresh)
        calls += 1
        cached += hit
        cost += (data.get("costDollars") or {}).get("total", 0) if not hit else 0
        lat.append(data.get("_latency_s"))
        res = [{"url": r.get("url"), "title": r.get("title"), "highlight": (r.get("highlights") or [None])[0]}
               for r in data.get("results", [])]
        rows.append({
            "osm_id": v["osm_id"], "name": v["name"], "profile": v["profile"], "city": v["city"],
            "osm_website": site, "query": q, "domain_restricted": bool(site), "error": data.get("error"),
            "results": res,
            "menu_url": pick(data.get("results", []), BANQUET_WORDS + MENU_WORDS if hotel else MENU_WORDS),
            "banquet_url": pick(data.get("results", []), BANQUET_WORDS) if hotel else None,
            "discovered_website": None if site or not res else res[0]["url"],
        })
    # One "find companies" style query: hotels with banquet services in Helsinki.
    comp_body = {"query": "hotel in Helsinki with banquet and conference catering services", "type": "auto",
                 "category": "company", "numResults": 15}
    comp, hit = exa(comp_body, refresh)
    calls += 1
    cached += hit
    cost += (comp.get("costDollars") or {}).get("total", 0) if not hit else 0
    # Second round: hotel banquet pages rarely list dishes, so look for the hotels' restaurant / Christmas menus.
    extra = []
    for name, q, dom in EXTRA:
        data, hit = exa({"query": q, "type": "auto", "numResults": 5, "includeDomains": [dom],
                         "contents": {"highlights": {"numSentences": 2, "highlightsPerUrl": 1}}}, refresh)
        calls += 1
        cached += hit
        cost += (data.get("costDollars") or {}).get("total", 0) if not hit else 0
        extra.append({"name": name, "query": q, "results": [{"url": r.get("url"), "title": r.get("title")} for r in data.get("results", [])],
                      "menu_url": pick(data.get("results", []), MENU_WORDS + ("joulu", "christmas", "pikkujoulu"))})
    out = {
        "source": "Exa search API", "hotel_menu_round": extra, "calls": calls, "cached_calls": cached,
        "cost_usd_this_run": round(cost, 4),
        "cost_usd_all_cached": round(sum((json.loads(f.read_text(encoding="utf-8")).get("costDollars") or {}).get("total", 0)
                                         for f in CACHE.glob("*.json")), 4),
        "venues": rows,
        "companies_query": {"query": comp_body["query"], "error": comp.get("error"),
                            "results": [{"url": r.get("url"), "title": r.get("title")} for r in comp.get("results", [])]},
    }
    (VEN / "exa_results.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    found = sum(1 for r in rows if r["menu_url"])
    print(f"venues {len(rows)}, menu/banquet url found {found}, discovered sites {sum(1 for r in rows if r['discovered_website'])}, "
          f"calls {calls} (cached {cached}), cost ${cost:.4f}, latencies {[x for x in lat if x]}")
    print("companies:", [r["title"] for r in out["companies_query"]["results"]])


if __name__ == "__main__":
    main()
