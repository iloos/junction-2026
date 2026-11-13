"""Probe Valio Aimo's mock API: behaviour, errors and gentle limits. All calls go through valio_cache.

Run from the repo root (key from env, never printed):
    export VALIO_API_KEY=$(grep '^VALIO_API_KEY=' .env | cut -d= -f2-)
    PYTHONIOENCODING=utf-8 python -I scripts/probe/valio_probe.py behaviour [--refresh]
    PYTHONIOENCODING=utf-8 python -I scripts/probe/valio_probe.py limits
    PYTHONIOENCODING=utf-8 python -I scripts/probe/valio_profile.py   # merges api_findings.json into the profile

Needs data/valio/probe/sample_ids.json (written by valio_profile.py).
Writes data/valio/probe/api_findings.json (aggregates; merged into docs/foundations/valio-profile.json).
"""
import json, statistics as st, sys, time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import valio_cache as vc  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PROBE = ROOT / "data" / "valio" / "probe"
FIND = PROBE / "api_findings.json"
REFRESH = "--refresh" in sys.argv
TODAY = date.today()


def d(n):
    return (TODAY + timedelta(days=n)).isoformat()


def next_weekday(wd):  # 0=Mon .. 6=Sun
    n = (wd - TODAY.weekday()) % 7 or 7
    return d(n)


def load_findings():
    return json.loads(FIND.read_text(encoding="utf-8")) if FIND.exists() else {}


def save_findings(f):
    FIND.write_text(json.dumps(f, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


def pcts(v, ps=(0, 5, 25, 50, 75, 95, 100)):
    v = sorted(v)
    return {f"p{p}": v[min(len(v) - 1, int(p / 100 * (len(v) - 1)))] for p in ps} if v else {}


def summarise_price(rec):
    b = rec["body"]
    if not isinstance(b, dict) or "products" not in b:
        return {"status": rec["status"], "body": str(b)[:400]}
    ps = b["products"]
    s = {"status": rec["status"], "latency_ms": rec["latency_ms"], "n": len(ps), "topKeys": sorted(b),
         "currency": b.get("currency"), "pricingDate": b.get("pricingDate"), "customerId": b.get("customerId"),
         "errorTrue": sum(1 for p in ps if p.get("error")), "netPriceFound": dict(Counter(str(p.get("netPriceFound")) for p in ps)),
         "comparisonUnit": dict(Counter(str(p.get("comparisonUnit")) for p in ps)),
         "taxRate": dict(Counter(str((p.get("tax") or {}).get("taxRate")) for p in ps)),
         "quantity": dict(Counter(str(p.get("quantity")) for p in ps)),
         "orderPreserved": [p.get("productId") for p in ps] == rec["products"]}
    ok = [p for p in ps if p.get("catalogPrice")]
    s["catalogPrice"] = pcts([p["catalogPrice"]["value"] for p in ok])
    s["listGtCatalogPct"] = round(100 * sum(1 for p in ok if p.get("listPrice") and p["listPrice"]["value"] > p["catalogPrice"]["value"] + 1e-9) / max(1, len(ok)), 1)
    s["listEqCatalogPct"] = round(100 * sum(1 for p in ok if p.get("listPrice") and abs(p["listPrice"]["value"] - p["catalogPrice"]["value"]) < 1e-9) / max(1, len(ok)), 1)
    disc = [1 - p["catalogPrice"]["value"] / p["listPrice"]["value"] for p in ok if p.get("listPrice") and p["listPrice"]["value"]]
    s["discountVsList"] = pcts([round(x, 3) for x in disc])
    s["priceWithTaxEqCatalogWithTaxPct"] = round(100 * sum(1 for p in ok if p.get("priceWithTax") and abs(p["priceWithTax"]["value"] - p["catalogPrice"]["valueWithTax"]) < 0.011) / max(1, len(ok)), 1)
    s["validity"] = dict(Counter(f'{p["catalogPrice"].get("validFrom")}..{p["catalogPrice"].get("validTo")}' for p in ok).most_common(5))
    s["listValidity"] = dict(Counter(f'{(p.get("listPrice") or {}).get("validFrom")}..{(p.get("listPrice") or {}).get("validTo")}' for p in ok).most_common(3))
    s["nullFields"] = dict(Counter(k for p in ps for k, v in p.items() if v is None))
    s["example"] = ps[0] if ps else None
    s["exampleError"] = next((p for p in ps if p.get("error")), None)
    return s


def summarise_avail(rec):
    b = rec["body"]
    if not isinstance(b, dict) or "products" not in b:
        return {"status": rec["status"], "body": str(b)[:400]}
    ps = b["products"]
    lines = [l for p in ps for l in p.get("scheduleLines") or []]
    amts = [l.get("availableAmount") for l in lines]
    real = [a for a in amts if a not in (0, 999999)]
    s = {"status": rec["status"], "latency_ms": rec["latency_ms"], "n": len(ps), "timeNow": b.get("timeNow"), "requestedDate": b.get("requestedDate"),
         "logisticModel": dict(Counter(str(p.get("logisticModel")) for p in ps)),
         "salesBlock": dict(Counter(str(p.get("salesBlock")) for p in ps)),
         "lineSalesBlock": dict(Counter(str(l.get("salesBlock")) for l in lines)),
         "scheduleLinesLen": dict(Counter(len(p.get("scheduleLines") or []) for p in ps)),
         "amount999999": sum(1 for a in amts if a == 999999), "amount0": sum(1 for a in amts if a == 0),
         "amountOther": pcts(real), "amountOtherN": len(real),
         "availableDateDeltaDays": dict(Counter(
             (datetime.fromisoformat(l["availableDate"][:10]) - datetime.fromisoformat(rec["requestedDate"])).days
             for l in lines if l.get("availableDate"))),
         "closingTimes": dict(Counter(str(p.get("closingTime")) for p in ps).most_common(6)),
         "closingTimeDistinct": len({p.get("closingTime") for p in ps}),
         "salesUnits": dict(Counter(l.get("salesUnit") for l in lines)),
         "modelVsAmount": dict(Counter(f'{p.get("logisticModel")}:{"none" if not p.get("scheduleLines") else ("999999" if p["scheduleLines"][0].get("availableAmount") == 999999 else ("0" if p["scheduleLines"][0].get("availableAmount") == 0 else "n"))}' for p in ps)),
         "orderPreserved": [p.get("productId") for p in ps] == rec["products"],
         "example": ps[0] if ps else None,
         "exampleEmpty": next((p for p in ps if not p.get("scheduleLines")), None),
         "exampleShort": next((p for p in ps if p.get("scheduleLines") and p["scheduleLines"][0].get("availableAmount") not in (0, 999999)), None)}
    return s


def by_id(rec):
    return {p["productId"]: p for p in (rec["body"] or {}).get("products", [])} if isinstance(rec["body"], dict) else {}


def diff(a, b, fields):
    A, B = by_id(a), by_id(b)
    changed = Counter()
    for i in A.keys() & B.keys():
        for f in fields:
            if json.dumps(A[i].get(f), sort_keys=True) != json.dumps(B[i].get(f), sort_keys=True):
                changed[f] += 1
    return {"compared": len(A.keys() & B.keys()), "changed": dict(changed)}


def behaviour():
    ids = json.loads((PROBE / "sample_ids.json").read_text())[:200]
    F = load_findings()
    status, headers, body, ms = vc.raw_post("ping", None)
    F["ping"] = {"status": status, "latency_ms": ms, "body": body, "headers": headers}
    s, _, b, _ = vc.raw_post("ping", None, api_key="wrong")
    F["pingBadKey"] = {"status": s, "body": b}
    D3, D14, SUN, PAST, TOD = d(3), d(14), next_weekday(6), d(-13), d(0)
    F["dates"] = {"today": TOD, "plus3": D3, "plus14": D14, "sunday": SUN, "past": PAST}
    pr = vc.call("price", "123", D3, ids, REFRESH, "behaviour")
    av = vc.call("availability", "123", D3, ids, REFRESH, "behaviour")
    F["price_plus3"] = summarise_price(pr)
    F["avail_plus3"] = summarise_avail(av)
    # customer effect
    pr2 = vc.call("price", "900001", D3, ids, REFRESH, "behaviour")
    av2 = vc.call("availability", "900001", D3, ids, REFRESH, "behaviour")
    PF = ["catalogPrice", "listPrice", "comparisonPrice", "priceWithTax", "netPriceFound"]
    AF = ["closingTime", "salesBlock", "logisticModel", "scheduleLines"]
    F["customerEffect"] = {"price": diff(pr, pr2, PF), "availability": diff(av, av2, AF), "customerIdEcho": (pr2["body"] or {}).get("customerId")}
    # date effect
    F["dateEffect"] = {}
    for label, dd in (("today", TOD), ("plus14", D14), ("sunday", SUN), ("past", PAST)):
        a = vc.call("availability", "123", dd, ids, REFRESH, "behaviour")
        F["dateEffect"][f"avail_{label}"] = {**summarise_avail(a), "vsPlus3": diff(av, a, AF)}
    for label, dd in (("plus14", D14), ("past", PAST)):
        p = vc.call("price", "123", dd, ids, REFRESH, "behaviour")
        F["dateEffect"][f"price_{label}"] = {**summarise_price(p), "vsPlus3": diff(pr, p, PF)}
    # determinism: re-fetch the same key (forced, not stored over the cache copy)
    st_, _, b2, ms2 = vc.raw_post("availability", {"customer": "123", "requestedDate": D3, "products": ids})
    st3, _, b3, ms3 = vc.raw_post("price", {"customer": "123", "requestedDate": D3, "products": ids})
    F["repeatSameRequest"] = {"availability": diff(av, {"body": b2}, AF), "price": diff(pr, {"body": b3}, PF), "latency_ms": [ms2, ms3],
                              "timeNowFirst": av["body"].get("timeNow"), "timeNowRepeat": b2.get("timeNow") if isinstance(b2, dict) else None}
    # errors
    E = {}
    r = vc.call("price", "123", D3, ids[:5] + ["999999999", "abc"], REFRESH, "errors")
    E["unknownIdsPrice"] = {"status": r["status"], "rows": [p for p in (r["body"] or {}).get("products", []) if p["productId"] in ("999999999", "abc")] if isinstance(r["body"], dict) else r["body"]}
    r = vc.call("availability", "123", D3, ids[:5] + ["999999999"], REFRESH, "errors")
    E["unknownIdAvail"] = {"status": r["status"], "rows": [p for p in (r["body"] or {}).get("products", []) if p["productId"] == "999999999"] if isinstance(r["body"], dict) else r["body"]}
    r = vc.call("price", "123", "2026-13-45", ids[:3], REFRESH, "errors")
    E["badDate"] = {"status": r["status"], "body": r["body"]}
    r = vc.call("price", "123", D3, [], REFRESH, "errors")
    E["emptyList"] = {"status": r["status"], "body": r["body"]}
    s, _, b, _ = vc.raw_post("availability", {"customer": "123", "requestedDate": D3, "products": [str(460000 + i) for i in range(1001)]})
    E["over1000"] = {"status": s, "body": str(b)[:500]}
    s, _, b, _ = vc.raw_post("price", {"requestedDate": D3, "products": ids[:2]})
    E["missingCustomer"] = {"status": s, "body": str(b)[:300]}
    F["errors"] = E
    save_findings(F)
    print(json.dumps({k: F[k] for k in ("ping", "customerEffect", "repeatSameRequest")}, indent=1, default=str)[:3000])


def limits():
    """Gentle ramp 1 -> 2 -> 4 -> 8 concurrent, <=200 ids each, distinct keys. Stops at the first 429/403/5xx or a latency jump."""
    F = load_findings()
    all_ids = sorted(p["id"] for p in json.loads((ROOT / "data/valio/valio_aimo_junction26_product_data.json").read_text(encoding="utf-8")))
    chunks = [all_ids[i:i + 200] for i in range(0, len(all_ids), 200)]
    ci = iter(chunks[10:])  # avoid the very first ids used in behaviour probes
    D = d(4)
    L = {"levels": [], "stoppedBecause": None, "rateHeadersSeen": {}}
    base_lat = None
    plan = [(1, 3), (2, 2), (4, 2), (8, 2)]
    calls = 0
    for conc, rounds in plan:
        lats, statuses = [], Counter()
        t0 = time.perf_counter()
        for _ in range(rounds):
            batch = [next(ci) for _ in range(conc)]
            with ThreadPoolExecutor(conc) as ex:
                recs = list(ex.map(lambda ch: vc.call("price" if calls % 2 == 0 else "availability", "123", D, ch, REFRESH, f"limits-c{conc}"), batch))
            calls += conc
            for r in recs:
                statuses[r["status"]] += 1
                if not r["cached"]:
                    lats.append(r["latency_ms"])
                for k, v in r["headers"].items():
                    if any(t in k.lower() for t in ("rate", "limit", "retry", "quota", "x-ratelimit")):
                        L["rateHeadersSeen"][k] = v
        wall = round((time.perf_counter() - t0) * 1000)
        lvl = {"concurrency": conc, "requests": conc * rounds, "statuses": dict(statuses), "latency_ms": pcts(lats, (0, 50, 100)), "wall_ms": wall}
        L["levels"].append(lvl)
        print(lvl)
        bad = [s for s in statuses if s in (429, 403) or s >= 500 or s < 0]
        if bad:
            L["stoppedBecause"] = f"status {bad}"
            break
        med = lvl["latency_ms"].get("p50")
        if base_lat is None:
            base_lat = med
        elif med and base_lat and med > 5 * base_lat and med > 2000:
            L["stoppedBecause"] = f"latency jump {base_lat} -> {med} ms"
            break
    # one 1000-id request per endpoint (documented max)
    big = [x for ch in chunks[60:65] for x in ch][:1000]
    for ep in ("price", "availability"):
        r = vc.call(ep, "123", D, big, REFRESH, "limits-1000")
        L[f"batch1000_{ep}"] = {"status": r["status"], "latency_ms": r["latency_ms"], "bytes": len(json.dumps(r["body"])), "cached": r["cached"]}
        print(ep, L[f"batch1000_{ep}"])
    L["sampleHeaders"] = r["headers"]
    F["limits"] = L
    save_findings(F)


def heroes():
    """Price + availability for demo hero candidates (top 10 per query + their substitutes). 2 calls."""
    H = json.loads((PROBE / "heroes.json").read_text(encoding="utf-8"))
    ids = []
    for v in H.values():
        for h in v["top"][:10]:
            ids += [h["id"]] + h["subs"]
    ids = list(dict.fromkeys(ids))[:1000]
    D = d(3)
    pr = by_id(vc.call("price", "123", D, ids, REFRESH, "heroes"))
    av = by_id(vc.call("availability", "123", D, ids, REFRESH, "heroes"))
    out = {}
    for k, v in H.items():
        rows = []
        for h in v["top"][:10]:
            p, a = pr.get(h["id"], {}), av.get(h["id"], {})
            sl = (a.get("scheduleLines") or [{}])[0] if a.get("scheduleLines") else {}
            rows.append({**h, "price": (p.get("catalogPrice") or {}).get("value"), "listPrice": (p.get("listPrice") or {}).get("value"),
                         "cmp": (p.get("comparisonPrice") or {}).get("value"), "cmpUnit": p.get("comparisonUnit"),
                         "tax": (p.get("tax") or {}).get("taxRate"), "model": a.get("logisticModel"), "closing": a.get("closingTime"),
                         "avail": sl.get("availableAmount") if sl else "NONE", "availDate": sl.get("availableDate"), "availUnit": sl.get("salesUnit")})
        out[k] = rows
    (PROBE / "heroes_priced.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    for k, rows in out.items():
        print("##", k)
        for r in rows:
            print(f' {r["id"]} {(r["fi"] or "")[:48]:48} su={r["salesUnit"]} units={r["units"]} net={r["netBase"]} '
                  f'€{r["price"]} cmp={r["cmp"]}/{r["cmpUnit"]} co2={r["co2"]} rel={r["rel"]} {r["origin"]} '
                  f'{r["model"]} avail={r["avail"]} {r["availUnit"]} close={r["closing"]} subs={r["subs"]}')


if __name__ == "__main__":
    {"behaviour": behaviour, "limits": limits, "heroes": heroes}[sys.argv[1]]()
