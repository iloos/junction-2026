"""Cache-through client for Valio Aimo's mock API (price, availability).

Every call is keyed by endpoint + customer + requestedDate + sorted product ids.
A hit is served from disk and never re-fetched unless refresh=True.

Layout (data/valio/cache/, gitignored):
  <endpoint>/<sha256[:20]>.json   one raw response with request + metadata
  index.jsonl                     one line per fetch: key, hash, endpoint, customer,
                                  requestedDate, n, ids, status, fetched_at, latency_ms
Only 2xx and 422 responses are cached (deterministic). 429/403/5xx/network errors are not.

The key is read from env VALIO_API_KEY; it is never written anywhere.
"""
import hashlib, json, os, time, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = os.environ.get("VALIO_BASE_URL", "https://junction26.valioaimo.fi")
ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "valio" / "cache"
ENDPOINTS = ("price", "availability")


def cache_key(endpoint, customer, requested_date, products):
    ids = ",".join(sorted(str(p) for p in products))
    return f"{endpoint}|{customer}|{requested_date}|{ids}"


def key_hash(key):
    return hashlib.sha256(key.encode()).hexdigest()[:20]


def _path(endpoint, h):
    return CACHE / endpoint / f"{h}.json"


def raw_post(endpoint, body, api_key=None, timeout=60):
    """One uncached HTTP call. Returns (status, headers, body_or_text, latency_ms)."""
    api_key = api_key if api_key is not None else os.environ.get("VALIO_API_KEY", "")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{BASE}/api/{endpoint}", data=data, method="POST" if data else "GET",
                                 headers={"X-API-Key": api_key, "Content-Type": "application/json",
                                          "User-Agent": "junction-probe/0.1"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            status, headers, raw = r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        status, headers, raw = e.code, dict(e.headers or {}), e.read()
    except Exception as e:  # network error
        return -1, {}, repr(e), round((time.perf_counter() - t0) * 1000)
    ms = round((time.perf_counter() - t0) * 1000)
    try:
        payload = json.loads(raw)
    except Exception:
        payload = raw.decode("utf-8", "replace")[:2000]
    return status, headers, payload, ms


def call(endpoint, customer, requested_date, products, refresh=False, tag=""):
    """Cache-through call. Returns a record dict: {key, hash, status, body, headers, latency_ms, fetched_at, cached}."""
    assert endpoint in ENDPOINTS
    key = cache_key(endpoint, customer, requested_date, products)
    h = key_hash(key)
    p = _path(endpoint, h)
    if p.exists() and not refresh:
        rec = json.loads(p.read_text(encoding="utf-8"))
        rec["cached"] = True
        return rec
    body = {"customer": customer, "requestedDate": requested_date, "products": list(products)}
    status, headers, payload, ms = raw_post(endpoint, body)
    rec = {"key_hash": h, "endpoint": endpoint, "customer": customer, "requestedDate": requested_date,
           "products": list(products), "status": status, "latency_ms": ms,
           "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "headers": {k: v for k, v in headers.items() if k.lower() not in ("set-cookie",)},
           "tag": tag, "body": payload, "cached": False}
    if 200 <= status < 300 or status == 422:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
    CACHE.mkdir(parents=True, exist_ok=True)
    with open(CACHE / "index.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps({"hash": h, "endpoint": endpoint, "customer": customer, "requestedDate": requested_date,
                            "n": len(products), "ids": sorted(products) if len(products) <= 50 else f"{len(products)} ids",
                            "status": status, "fetched_at": rec["fetched_at"], "latency_ms": ms,
                            "stored": p.exists(), "tag": tag}) + "\n")
    return rec
