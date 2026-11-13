"""Extract structured menus with Context.dev (POST /v1/web/scrape, formats.json + a dish schema),
and try the brand endpoint on a few venues.

Reads CONTEXT_DEV_API_KEY from the environment (never written anywhere).
Throttled to one request every 8 s (<= 7.5/min; the plan allows 10/min). No automatic retries:
a 429 or error is recorded and skipped. Every raw response is cached in data/venues/menus/raw/,
so a rerun only fetches what is missing (pass --refresh to refetch).
Input:  data/venues/menu_targets.json  [{osm_id, name, profile, url}]  (built by enrich.py --targets)
Output: data/venues/menus/<osm_id>.json (normalised menu) and data/venues/menus/index.json

Usage: CONTEXT_DEV_API_KEY=... python -I scripts/venues/scrape_menus.py [--brand domain1,domain2,domain3]
"""
import hashlib, json, os, sys, time, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VEN = ROOT / "data" / "venues"
MENUS = VEN / "menus"
RAW = MENUS / "raw"
API = "https://api.context.dev/v1"
GAP_S = 8.0
SCHEMA = {
    "type": "object",
    "properties": {
        "dishes": {"type": "array", "items": {"type": "object", "properties": {
            "name": {"type": "string"},
            "description": {"type": "string"},
            "price": {"type": ["number", "null"], "description": "price in EUR, null if not shown"},
            "section": {"type": "string", "description": "menu section, e.g. starters, mains, lunch Monday, drinks"},
            "isFood": {"type": "boolean", "description": "false for drinks, wine, beer"},
            "language": {"type": "string", "description": "fi, en, sv"},
        }, "required": ["name"]}},
        "menuType": {"type": "string", "description": "lunch, a la carte, buffet, banquet, cafe, tasting"},
        "validFor": {"type": "string", "description": "dates or week the menu is for, if stated"},
    },
    "required": ["dishes"],
}
_last = [0.0]


def call(method, path, body=None, refresh=False):
    key = hashlib.sha256(f"{method} {path} {json.dumps(body, sort_keys=True)}".encode()).hexdigest()[:20]
    f = RAW / f"{key}.json"
    if f.exists() and not refresh:
        return json.loads(f.read_text(encoding="utf-8")), True
    wait = GAP_S - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body else None, method=method, headers={
        "Authorization": "Bearer " + os.environ["CONTEXT_DEV_API_KEY"], "Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=130) as r:
            data = json.loads(r.read().decode("utf-8"))
            data["_credits_header"] = r.headers.get("X-Credits-Used")
            data["_status"] = r.status
    except urllib.error.HTTPError as e:
        data = {"_status": e.code, "_error": e.read().decode("utf-8", "replace")[:800]}
    except Exception as e:  # timeout / network
        data = {"_status": None, "_error": repr(e)}
    _last[0] = time.time()
    data["_latency_s"] = round(time.time() - t0, 1)
    data["_request"] = {"method": method, "path": path, "body": body}
    data["_fetched_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if data["_status"] != 429:  # never cache a rate-limit response
        f.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return data, False


def credits(d):
    km = d.get("key_metadata") or {}
    return km.get("credits_consumed") or d.get("_credits_header")


def scrape(t, refresh):
    body = {"url": t["url"], "formats": {"json": True}, "jsonParams": {"schema": SCHEMA},
            "timeoutOpts": {"milliseconds": 90000, "behavior": "fail"}}
    d, hit = call("POST", "/web/scrape", body, refresh)
    js = d.get("json") or {}
    data = js.get("data") if isinstance(js, dict) else None
    dishes = (data or {}).get("dishes") or []
    menu = {
        "osm_id": t["osm_id"], "name": t["name"], "profile": t["profile"], "source_url": t["url"],
        "source": "Context.dev web/scrape formats.json", "fetched_at": d.get("_fetched_at"),
        "menuType": (data or {}).get("menuType"), "validFor": (data or {}).get("validFor"),
        "dishes": dishes,
    }
    stat = {"osm_id": t["osm_id"], "name": t["name"], "profile": t["profile"], "url": t["url"],
            "status": d.get("_status"), "ok": bool(dishes), "n_dishes": len(dishes),
            "n_priced": sum(1 for x in dishes if isinstance(x.get("price"), (int, float))),
            "n_food": sum(1 for x in dishes if x.get("isFood") is not False),
            "latency_s": d.get("_latency_s"), "credits": credits(d), "cached": hit,
            "error": d.get("_error") or (js.get("error") if isinstance(js, dict) else None)}
    if dishes:
        mid = t["osm_id"].replace("/", "_")
        (MENUS / f"{mid}.json").write_text(json.dumps(menu, ensure_ascii=False, indent=1), encoding="utf-8")
        stat["menu_id"] = mid
    return stat


def brand(domain, refresh):
    d, hit = call("POST", "/brand/retrieve", {"type": "by_domain", "domain": domain,
                                              "timeoutOpts": {"milliseconds": 60000, "behavior": "fail"}}, refresh)
    b = d.get("brand") or {}
    return {"domain": domain, "status": d.get("_status"), "latency_s": d.get("_latency_s"), "credits": credits(d),
            "cached": hit, "error": d.get("_error"),
            "fields_present": sorted(k for k, v in b.items() if v not in (None, "", [], {})),
            "title": b.get("title"), "description": (b.get("description") or "")[:300],
            "industries": b.get("industries"), "address": b.get("address"),
            "n_logos": len(b.get("logos") or []), "n_colors": len(b.get("colors") or [])}


def pdf_links(url, refresh=False):
    """Hotel menus are often PDFs linked from the dining page: list the page's .pdf links (prebuilt `links` parser)."""
    d, _ = call("POST", "/web/scrape", {"url": url, "formats": {"parse": True},
                                        "parseParams": {"type": "prebuilt", "parser": "links"}}, refresh)
    blob = json.dumps(d.get("parse") or d.get("parsed") or d)
    import re
    return sorted(set(re.findall(r'https?://[^"\ ]+?\.pdf', blob)))


def main():
    refresh = "--refresh" in sys.argv
    if "--pdf-links" in sys.argv:
        RAW.mkdir(parents=True, exist_ok=True)
        for u in sys.argv[sys.argv.index("--pdf-links") + 1].split(","):
            print(u, pdf_links(u, refresh))
        return
    RAW.mkdir(parents=True, exist_ok=True)
    targets = json.loads((VEN / "menu_targets.json").read_text(encoding="utf-8"))
    stats = []
    for t in targets:
        s = scrape(t, refresh)
        stats.append(s)
        print(f"{s['status']} {s['n_dishes']:>3} dishes {s['latency_s']}s {'(cache)' if s['cached'] else ''} {t['name']} {t['url']}", flush=True)
    brands = []
    if "--brand" in sys.argv:
        for dom in sys.argv[sys.argv.index("--brand") + 1].split(","):
            b = brand(dom, refresh)
            brands.append(b)
            print("brand", dom, b["status"], b["fields_present"], flush=True)
    (MENUS / "index.json").write_text(json.dumps({"scrapes": stats, "brands": brands}, ensure_ascii=False, indent=1), encoding="utf-8")
    ok = [s for s in stats if s["ok"]]
    print(f"menus ok {len(ok)}/{len(stats)}, dishes {sum(s['n_dishes'] for s in ok)}")


if __name__ == "__main__":
    main()
