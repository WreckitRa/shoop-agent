#!/usr/bin/env python3
"""
Shoop supply pre-pass.
Reads the curation workbook, checks every store, writes a -CHECKED copy.

Per store:
  1/ Shopify detection   : GET /products.json (fallback: homepage fingerprint)
  2/ Shopify GID         : /meta.json id, else homepage "shopId" regex
  3/ Liveness            : latest product updated_at within 60 days
  4/ Catalog size        : products paginated (cap 1,000), bar = 100+ SKUs
  5/ Price-band audit    : median listed price -> tier band vs estimated tier
  6/ Size-run smell      : share of products with 3+ size variants

Workbook layouts supported:
  Legacy (Women / Men):
    A Store | B Website | C Gender | D Est. ticket tier | ...
  Target lists (category sheets):
    GID | Store | Category | Ticket Bucket | ... | Website | ...

Usage:
  python3 -m venv .venv-prepass && source .venv-prepass/bin/activate
  pip install requests openpyxl
  python scripts/shoop_prepass.py Shoop-First-250-Shops.xlsx
  -> writes Shoop-First-250-Shops-CHECKED.xlsx  (original untouched)

Options:
  --workers 1       concurrency (default 1 — Cloudflare rate-limits hard)
  --delay 1.5       seconds between stores (default 1.5)
  --sheet NAME      run one sheet only (default: Women+Men, else all data sheets)
  --limit 20        only first N rows per sheet (for a test run)
  --resume          skip rows that already have a non-MANUAL Pre-pass verdict

Also skips domains already decided in sibling *-CHECKED.xlsx workbooks
(copies prior GID/verdict into the new CHECKED file).
"""
from __future__ import annotations

import argparse
import random
import re
import statistics
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

import requests
from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill

# Browser-like UA — custom bot UAs get 429'd faster on Cloudflare-fronted shops.
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
TIMEOUT = 15
DAYS_ALIVE = 60
MIN_SKUS = 100
MAX_RETRIES = 4
_rate_lock = threading.Lock()
_last_request_at = 0.0
_min_request_gap = 0.35  # global floor between any two HTTP calls
SIZE_TOKENS = {
    "xxs",
    "xs",
    "s",
    "m",
    "l",
    "xl",
    "xxl",
    "xxxl",
    "2xl",
    "3xl",
    "4xl",
    "0",
    "2",
    "4",
    "6",
    "8",
    "10",
    "12",
    "14",
    "16",
    "one size",
}
TIERS = [
    ("$100", 0, 120),
    ("$200", 120, 280),
    ("$400", 280, 600),
    ("$1,000", 600, 1400),
    ("$1,000+", 1400, 10**9),
]

NEW_COLS = [
    "Shopify GID",
    "myshopify domain",
    "Platform",
    "SKUs found",
    "Days since update",
    "Median price",
    "Audited tier",
    "Size-run %",
    "Pre-pass verdict",
    "Checked",
]


def tier_of(median: float) -> str:
    for name, lo, hi in TIERS:
        if lo <= median < hi:
            return name
    return "?"


def _throttle() -> None:
    """Global polite gap so concurrent workers don't stampede Cloudflare."""
    global _last_request_at
    with _rate_lock:
        now = time.monotonic()
        wait = _min_request_gap - (now - _last_request_at)
        if wait > 0:
            time.sleep(wait)
        _last_request_at = time.monotonic()


def get(url: str, **kw: Any) -> requests.Response:
    """GET with throttle + exponential backoff on 429/403."""
    last: requests.Response | None = None
    for attempt in range(MAX_RETRIES):
        _throttle()
        try:
            r = requests.get(url, headers=UA, timeout=TIMEOUT, allow_redirects=True, **kw)
        except requests.RequestException:
            if attempt == MAX_RETRIES - 1:
                raise
            time.sleep(2 ** attempt + random.uniform(0.2, 0.8))
            continue
        last = r
        if r.status_code not in (403, 429):
            return r
        # Honor Retry-After when present; otherwise backoff hard.
        ra = r.headers.get("Retry-After")
        try:
            sleep_s = float(ra) if ra else (2 ** attempt) * 2 + random.uniform(1.0, 3.0)
        except ValueError:
            sleep_s = (2 ** attempt) * 2 + random.uniform(1.0, 3.0)
        sleep_s = min(sleep_s, 45.0)
        time.sleep(sleep_s)
    assert last is not None
    return last


def normalize_domain(domain: str) -> str:
    d = domain.strip().rstrip("/")
    for prefix in ("https://", "http://"):
        if d.lower().startswith(prefix):
            d = d[len(prefix) :]
    return d.rstrip("/")


def fetch_products(base: str) -> tuple[list[dict[str, Any]] | None, str]:
    """Paginate products.json up to 1,000 items. Returns (list|None, note)."""
    items: list[dict[str, Any]] = []
    for page in range(1, 5):
        try:
            r = get(f"{base}/products.json", params={"limit": 250, "page": page})
        except requests.RequestException as e:
            return None, f"conn: {type(e).__name__}"
        if r.status_code != 200:
            return (items if items else None), f"http {r.status_code}"
        try:
            batch = r.json().get("products", [])
        except ValueError:
            return (items if items else None), "non-json"
        if not isinstance(batch, list):
            return (items if items else None), "bad-shape"
        items.extend(batch)
        if len(batch) < 250:
            break
        time.sleep(0.6)
    return items, "ok"


def harvest_gid(base: str) -> tuple[str | None, str, str]:
    """Try /meta.json, then homepage shopId regex. Returns (gid, myshopify, note)."""
    blocked_note: str | None = None
    try:
        r = get(f"{base}/meta.json")
        if r.status_code == 200:
            j = r.json()
            sid = j.get("id")
            if sid:
                return f"gid://shopify/Shop/{sid}", j.get("myshopify_domain", "") or "", "meta.json"
        elif r.status_code in (401, 403, 429):
            blocked_note = f"blocked:{r.status_code}"
    except (requests.RequestException, ValueError):
        pass

    try:
        r = get(base)
        if r.status_code in (401, 403, 429):
            return None, "", f"blocked:{r.status_code}"
        html = r.text[:400000]
        # Cloudflare / bot interstitial — no usable fingerprint
        if "cf-browser-verification" in html or "Just a moment" in html[:2000]:
            return None, "", "blocked:challenge"
        m = re.search(r'"shopId"\s*:\s*(\d+)', html) or re.search(
            r"Shopify\.shop_id\s*=\s*(\d+)", html
        )
        my = re.search(r"([a-z0-9][a-z0-9\-]*\.myshopify\.com)", html, re.I)
        sid = m.group(1) if m else None
        shopify_fingerprint = (
            ("cdn.shopify.com" in html) or ("Shopify.shop" in html) or bool(my)
        )
        myshopify = my.group(1).lower() if my else ""
        if sid:
            return f"gid://shopify/Shop/{sid}", myshopify, "homepage"
        if shopify_fingerprint:
            return None, myshopify, "fingerprint"
        if blocked_note:
            return None, "", blocked_note
        return None, myshopify, "none"
    except requests.RequestException as e:
        return None, "", f"conn: {type(e).__name__}"


def pick_base(domain: str) -> tuple[str, list[dict[str, Any]] | None, str]:
    """Try apex then www for products.json; return (base, products|None, note)."""
    last_base = f"https://{domain}"
    last_note = "none"
    for host in (domain, f"www.{domain}"):
        base = f"https://{host}"
        products, pnote = fetch_products(base)
        last_base, last_note = base, pnote
        if products is not None:
            return base, products, pnote
        # Don't hammer www if apex was a hard bot-block — same IP, same fate.
        if pnote.startswith("http") and any(c in pnote for c in ("401", "403", "429")):
            return base, None, pnote
    return last_base, None, last_note


def audit(products: list[dict[str, Any]]) -> tuple[float | None, int, int | None]:
    """Median price, size-run share, freshness days from a product list."""
    prices: list[float] = []
    sized = 0
    newest: datetime | None = None
    for p in products:
        vs = p.get("variants") or []
        pv = [float(v["price"]) for v in vs if v.get("price") not in (None, "")]
        if pv:
            prices.append(statistics.median(pv))
        opts = {
            str(o).strip().lower()
            for v in vs
            for o in [v.get("option1"), v.get("option2")]
            if o
        }
        if len(opts & SIZE_TOKENS) >= 3:
            sized += 1
        u = p.get("updated_at") or p.get("published_at")
        if u:
            try:
                d = datetime.fromisoformat(str(u).replace("Z", "+00:00"))
                newest = d if (newest is None or d > newest) else newest
            except ValueError:
                pass
    med = round(statistics.median(prices), 2) if prices else None
    size_pct = round(100 * sized / len(products)) if products else 0
    days = (datetime.now(timezone.utc) - newest).days if newest else None
    return med, size_pct, days


def empty_result() -> dict[str, Any]:
    return {
        "gid": "",
        "myshopify": "",
        "platform": "",
        "skus": "",
        "days": "",
        "median": "",
        "audited_tier": "",
        "size_pct": "",
        "verdict": "",
    }


def check_store(name: str, domain: str, est_tier: str | None) -> tuple[str, dict[str, Any]]:
    domain = normalize_domain(str(domain))
    res = empty_result()
    est = (est_tier or "").strip()

    base, products, pnote = pick_base(domain)
    # Only dig for GID when we already know it's Shopify (or need fingerprint).
    # Skip extra homepage hits when products.json already succeeded with a meta.json path.
    gid, my, gnote = harvest_gid(base)

    res["gid"], res["myshopify"] = gid or "", my
    catalog_blocked = pnote.startswith("http") and any(
        code in pnote for code in ("401", "403", "429")
    )

    if products:
        res["platform"] = "Shopify"
        res["skus"] = len(products)
        med, size_pct, days = audit(products)
        res["median"], res["size_pct"], res["days"] = med, size_pct, days
        res["audited_tier"] = tier_of(med) if med is not None else "?"
        kills: list[str] = []
        if len(products) < MIN_SKUS:
            kills.append(f"catalog {len(products)}<{MIN_SKUS}")
        if days is not None and days > DAYS_ALIVE:
            kills.append(f"stale {days}d")
        if size_pct < 20:
            kills.append(f"size-runs {size_pct}%")
        if med is not None and est and res["audited_tier"] != est:
            kills.append(f"tier {res['audited_tier']} vs est {est}")
        hard = [k for k in kills if not k.startswith("tier")]
        if hard:
            res["verdict"] = "KILL: " + "; ".join(kills)
        elif kills:
            res["verdict"] = "RETIER: " + kills[0].replace("tier ", "")
        else:
            res["verdict"] = "PASS"
    elif my or gnote == "fingerprint":
        res["platform"] = "Shopify (products.json blocked)"
        res["verdict"] = "MANUAL: catalog endpoint blocked — audit by hand"
    elif catalog_blocked or gnote.startswith("blocked"):
        res["platform"] = "unknown (bot-blocked)"
        res["verdict"] = f"MANUAL: {pnote} / {gnote} — cannot confirm platform"
    elif gnote.startswith("conn"):
        res["platform"] = "unreachable"
        res["verdict"] = f"MANUAL: {gnote}"
    else:
        res["platform"] = "not Shopify (no fingerprint)"
        res["verdict"] = "KILL: not Shopify"
    return name, res

SKIP_SHEETS = {"README", "Summary", "readme", "summary"}


def _header_map(ws: Any) -> dict[str, int]:
    """Map header label -> 1-based column index (first row)."""
    return {
        str(ws.cell(row=1, column=c).value).strip(): c
        for c in range(1, ws.max_column + 1)
        if ws.cell(row=1, column=c).value
    }


def detect_input_columns(ws: Any) -> dict[str, int] | None:
    """
    Resolve Store / Website / tier columns for legacy, target-list, or Farfetch layouts.
    Returns None when the sheet is not a store list.
    """
    headers = _header_map(ws)
    store = headers.get("Store") or headers.get("Brand")
    website = headers.get("Website") or headers.get("Own Website")
    if not store or not website:
        return None
    tier = (
        headers.get("Est. ticket tier")
        or headers.get("Ticket Bucket")
        or headers.get("Est. AOV Band")
        or headers.get("Est. Item Band")
    )
    return {"store": store, "website": website, "tier": tier or 0}


def _norm_domain(domain: str | None) -> str | None:
    if not domain:
        return None
    d = normalize_domain(str(domain)).lower()
    if d.startswith("www."):
        d = d[4:]
    return d or None


def load_known_checks(exclude: str | None = None) -> dict[str, dict[str, Any]]:
    """
    Index decisive pre-pass results from sibling *-CHECKED.xlsx workbooks by domain.
    Used to skip re-checking brands already audited on another list.
    """
    from pathlib import Path

    known: dict[str, dict[str, Any]] = {}
    root = Path(exclude).resolve().parent if exclude else Path.cwd()
    exclude_name = Path(exclude).name if exclude else None
    for path in sorted(root.glob("*-CHECKED.xlsx")):
        if exclude_name and path.name == exclude_name:
            continue
        try:
            wb = load_workbook(path, read_only=True, data_only=True)
        except Exception:
            continue
        for sn in wb.sheetnames:
            ws = wb[sn]
            header_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), None)
            if not header_row:
                continue
            headers = list(header_row)
            if "Pre-pass verdict" not in headers:
                continue

            def _find(*names: str) -> int | None:
                for n in names:
                    if n in headers:
                        return headers.index(n)
                return None

            wi = _find("Website", "Own Website")
            vi = headers.index("Pre-pass verdict")
            # Prefer rightmost Shopify GID (pre-pass block) over source GID cols.
            gi = None
            for i, h in enumerate(headers):
                if h == "Shopify GID":
                    gi = i
            if wi is None:
                continue
            # Optional companion columns from NEW_COLS
            col_idx = {h: headers.index(h) for h in NEW_COLS if h in headers}
            # If duplicate headers, take rightmost for result fields
            for h in NEW_COLS:
                for i, name in enumerate(headers):
                    if name == h:
                        col_idx[h] = i

            for row in ws.iter_rows(min_row=2, values_only=True):
                domain = _norm_domain(row[wi] if wi < len(row) else None)
                verdict = row[vi] if vi < len(row) else None
                if not domain or not verdict:
                    continue
                s = str(verdict)
                if not (s.startswith(("PASS", "KILL", "RETIER")) and "cannot confirm" not in s):
                    continue
                res = empty_result()
                res["verdict"] = s
                if gi is not None and gi < len(row) and row[gi]:
                    res["gid"] = str(row[gi]).strip()
                for key, header in [
                    ("myshopify", "myshopify domain"),
                    ("platform", "Platform"),
                    ("skus", "SKUs found"),
                    ("days", "Days since update"),
                    ("median", "Median price"),
                    ("audited_tier", "Audited tier"),
                    ("size_pct", "Size-run %"),
                ]:
                    hi = col_idx.get(header)
                    if hi is not None and hi < len(row) and row[hi] not in (None, ""):
                        res[key] = row[hi]
                known[domain] = res
        wb.close()
    return known


def default_sheets(wb: Any) -> list[str]:
    """Prefer Women/Men; otherwise every non-README data sheet with Store+Website."""
    names = list(wb.sheetnames)
    if "Women" in names or "Men" in names:
        return [s for s in ("Women", "Men") if s in names]
    out: list[str] = []
    for sn in names:
        if sn in SKIP_SHEETS:
            continue
        ws = wb[sn]
        if detect_input_columns(ws):
            out.append(sn)
    return out


def _rightmost_header_index(existing: list[Any], header: str) -> int | None:
    """1-based index of the rightmost matching header (avoids clashing with source cols)."""
    idx = None
    for i, h in enumerate(existing):
        if h == header:
            idx = i + 1
    return idx


def ensure_columns(ws: Any) -> dict[str, int]:
    """Ensure result columns exist; return header -> 1-based column index."""
    base_col = ws.max_column
    existing = [ws.cell(row=1, column=c).value for c in range(1, base_col + 1)]
    # Prefer the pre-pass block (rightmost) so source "Platform" / "GID" aren't overwritten.
    if "Pre-pass verdict" not in existing:
        start = base_col + 1
        for i, h in enumerate(NEW_COLS):
            cell = ws.cell(row=1, column=start + i, value=h)
            cell.font = Font(name="Arial", bold=True, color="FFFFFF", size=10)
            cell.fill = PatternFill("solid", start_color="1A1A2E")
        return {h: start + j for j, h in enumerate(NEW_COLS)}

    col: dict[str, int] = {}
    for h in NEW_COLS:
        found = _rightmost_header_index(existing, h)
        if found is not None:
            col[h] = found
    # Backfill any missing NEW_COLS (e.g. older CHECKED file)
    next_col = ws.max_column + 1
    for h in NEW_COLS:
        if h not in col:
            cell = ws.cell(row=1, column=next_col, value=h)
            cell.font = Font(name="Arial", bold=True, color="FFFFFF", size=10)
            cell.fill = PatternFill("solid", start_color="1A1A2E")
            col[h] = next_col
            next_col += 1
    return col


def _should_skip_resume(ws: Any, row: int, col: dict[str, int]) -> bool:
    """Skip rows that already have a decisive (non-MANUAL) verdict."""
    if "Pre-pass verdict" not in col:
        return False
    v = ws.cell(row, col["Pre-pass verdict"]).value
    if not v:
        return False
    s = str(v)
    return s.startswith(("PASS", "KILL", "RETIER")) and "cannot confirm" not in s


def main() -> None:
    ap = argparse.ArgumentParser(description="Shoop supply pre-pass over curation workbook")
    ap.add_argument("workbook")
    ap.add_argument("--workers", type=int, default=1, help="Concurrency (default 1 — stay under CF)")
    ap.add_argument("--delay", type=float, default=1.5, help="Seconds between stores (default 1.5)")
    ap.add_argument(
        "--sheet",
        default=None,
        help="Run one sheet only (default: Women+Men, else all data sheets)",
    )
    ap.add_argument("--limit", type=int, default=None, help="Only first N rows per sheet")
    ap.add_argument(
        "--resume",
        action="store_true",
        help="Skip rows that already have PASS/KILL/RETIER (re-check MANUAL only)",
    )
    a = ap.parse_args()

    # Prefer reading a prior -CHECKED file when resuming so we don't wipe progress.
    src = a.workbook
    out = a.workbook.replace(".xlsx", "-CHECKED.xlsx")
    if a.resume and out != src:
        try:
            wb = load_workbook(out)
            print(f"Resuming from existing {out}")
        except FileNotFoundError:
            wb = load_workbook(src)
    else:
        wb = load_workbook(src)

    sheets = [a.sheet] if a.sheet else default_sheets(wb)
    today = datetime.now().strftime("%Y-%m-%d")
    known = load_known_checks(exclude=out)
    if known:
        print(f"Loaded {len(known)} already-checked domains from sibling *-CHECKED.xlsx files")

    for sn in sheets:
        if sn not in wb.sheetnames:
            print(f"[{sn}] sheet missing — skip")
            continue
        ws = wb[sn]
        inputs = detect_input_columns(ws)
        if not inputs:
            print(f"[{sn}] no Store/Website columns — skip")
            continue
        col = ensure_columns(ws)

        rows: list[tuple[int, str, str, str | None]] = []
        skipped = 0
        reused = 0
        for r in range(2, ws.max_row + 1):
            name = ws.cell(r, inputs["store"]).value
            domain = ws.cell(r, inputs["website"]).value
            tier = ws.cell(r, inputs["tier"]).value if inputs["tier"] else None
            if not (name and domain):
                continue
            if a.resume and _should_skip_resume(ws, r, col):
                skipped += 1
                continue
            # Reuse decisive results from other CHECKED workbooks (same domain).
            prior = known.get(_norm_domain(str(domain)) or "")
            if prior:
                _write_row(ws, r, col, prior, today)
                reused += 1
                continue
            rows.append((r, str(name), str(domain), str(tier) if tier else None))
        if a.limit:
            rows = rows[: a.limit]

        print(
            f"[{sn}] checking {len(rows)} stores "
            f"(skipped {skipped}, reused {reused}) with {a.workers} workers, delay={a.delay}s..."
        )
        done = 0
        # Sequential path is the polite default; pool only when workers > 1.
        if a.workers <= 1:
            for r, n, d, t in rows:
                try:
                    name, res = check_store(n, d, t)
                except Exception as e:
                    name, res = n, empty_result()
                    res["verdict"] = f"MANUAL: script error {type(e).__name__}"
                _write_row(ws, r, col, res, today)
                done += 1
                gid_short = (res.get("gid") or "")[-12:] or "-"
                print(f"  {done}/{len(rows)}  {name}: {res.get('verdict')}  [{gid_short}]")
                # Checkpoint every 10 stores so Ctrl-C doesn't lose the run.
                if done % 10 == 0:
                    wb.save(out)
                    print(f"  …checkpoint saved → {out}")
                time.sleep(a.delay + random.uniform(0, 0.5))
        else:
            with ThreadPoolExecutor(max_workers=a.workers) as ex:
                futs = {ex.submit(check_store, n, d, t): r for r, n, d, t in rows}
                for f in as_completed(futs):
                    r = futs[f]
                    try:
                        name, res = f.result()
                    except Exception as e:
                        name = ws.cell(r, 1).value
                        res = empty_result()
                        res["verdict"] = f"MANUAL: script error {type(e).__name__}"
                    _write_row(ws, r, col, res, today)
                    done += 1
                    gid_short = (res.get("gid") or "")[-12:] or "-"
                    print(f"  {done}/{len(rows)}  {name}: {res.get('verdict')}  [{gid_short}]")
                    if done % 10 == 0:
                        wb.save(out)
                        print(f"  …checkpoint saved → {out}")
                    time.sleep(a.delay)

        for h in NEW_COLS:
            ws.column_dimensions[ws.cell(1, col[h]).column_letter].width = 16
        ws.column_dimensions[ws.cell(1, col["Shopify GID"]).column_letter].width = 28
        ws.column_dimensions[ws.cell(1, col["myshopify domain"]).column_letter].width = 28
        ws.column_dimensions[ws.cell(1, col["Pre-pass verdict"]).column_letter].width = 40

    wb.save(out)
    print(f"\nWritten: {out}")
    print(
        "Verdict key: PASS = pool-ready pending your eye. "
        "RETIER = healthy store, tier corrected. "
        "KILL = failed a hard bar. "
        "MANUAL = needs a human look (often rate-limit — re-run with --resume)."
    )


def _write_row(ws: Any, r: int, col: dict[str, int], res: dict[str, Any], today: str) -> None:
    for h, key in [
        ("Shopify GID", "gid"),
        ("myshopify domain", "myshopify"),
        ("Platform", "platform"),
        ("SKUs found", "skus"),
        ("Days since update", "days"),
        ("Median price", "median"),
        ("Audited tier", "audited_tier"),
        ("Size-run %", "size_pct"),
        ("Pre-pass verdict", "verdict"),
    ]:
        ws.cell(r, col[h], res.get(key, ""))
    ws.cell(r, col["Checked"], today)
    v = str(res.get("verdict", ""))
    fill = (
        "D9F2E4"
        if v == "PASS"
        else ("FDEDEE" if v.startswith("KILL") else "FFF6E5")
    )
    ws.cell(r, col["Pre-pass verdict"]).fill = PatternFill("solid", start_color=fill)


if __name__ == "__main__":
    main()
