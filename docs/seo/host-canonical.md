# Host + HTTPS canonical audit

**Checked:** 2026-08-25 (live `GET` probes from a public network)  
**Product brand string:** `Shoop — AI Shopping Concierge`  
**Canonical origin:** `https://www.shoop.world`

This file answers three authority questions. Re-run the matrix with `GET` (not `HEAD`) if DNS or forwarding changes.

---

## 1. Apex and www resolve; permanent redirect to canonical

| Request | Status | `Location` | Notes |
|---------|--------|------------|-------|
| `GET https://shoop.world/` | **301** | `https://www.shoop.world` | Permanent → canonical |
| `GET https://shoop.world` | **301** | `https://www.shoop.world` | Same |
| `GET https://www.shoop.world/` | **200** | — | Live app (Railway) |
| `GET https://www.shoop.world` | **200** | — | Same |

DNS (at check time):

| Host | Records |
|------|---------|
| `shoop.world` | `A` → `15.197.225.128`, `3.33.251.168` (GoDaddy / AWS Global Accelerator forwarder) |
| `www.shoop.world` | `CNAME` → `m7bbpd6h.up.railway.app.` |

TLS: apex cert `CN=shoop.world` (GoDaddy); www cert `CN=www.shoop.world` (Railway edge). Both validate.

**Caveat:** `HEAD https://shoop.world/` returns **405** on the forwarder. Crawlers that only HEAD may misread apex; browsers and normal `GET` crawlers see the 301. Prefer publishing www so they never need the apex hop.

No **302 / 307 / 308** on the host matrix — the apex→www hop is a **permanent** 301.

App code does **not** implement host redirects (`next.config.ts` has no `redirects()`). Canonicalization is edge/DNS.

---

## 2. HTTPS is enforced on both

| Request | Status | `Location` |
|---------|--------|------------|
| `GET http://shoop.world/` | **301** | `https://www.shoop.world` |
| `GET http://shoop.world` | **301** | `https://www.shoop.world` |
| `GET http://www.shoop.world/` | **301** | `https://www.shoop.world/` |
| `GET http://www.shoop.world` | **301** | `https://www.shoop.world/` |

Apex HTTP upgrades **and** moves to www in one permanent hop. Www HTTP upgrades to HTTPS permanently (Railway).

**Gap (edge):** apex GoDaddy forwarder still returns **405** on `HEAD`. App now sets HSTS on www responses and middleware 301s if apex ever hits Railway.

---

## 3. Published links and authority

### Declared canonical (in HTML / SEO artifacts)

Live `https://www.shoop.world/` emits:

- `<title>Shoop — AI Shopping Concierge | Shoop</title>` (template merge; brand string present)
- `link rel="canonical" href="https://www.shoop.world"`
- `og:url` / `og:title` / Twitter title keyed off the same origin and brand
- `robots.txt` → `Host: https://www.shoop.world`
- `sitemap.xml` → locs under `https://www.shoop.world…`

`{ORIGIN}` in share meta is `NEXT_PUBLIC_APP_URL` — production must stay **`https://www.shoop.world`**.

### In-product crawlable / share URLs

| Surface | Form used | Risk |
|---------|-----------|------|
| Ask share (`askShareAbsoluteUrl`) | `window.location.origin` + path | OK when the user is already on www |
| Email verify / Ask API public URLs | `getSiteUrl().origin` | OK if env is www HTTPS |
| Sitemap / robots / JSON-LD | `getSiteUrl().origin` | OK if env is www HTTPS |

### Brand mentions (not always full URLs)

| Place | Form | Notes |
|-------|------|-------|
| Legal terms | `shoop.world` | Brand mention; apex 301s if typed as URL |
| Onboarding verdict copy | trailing `shoop.world` | Plain text, not `https://www…` |
| Public posts (e.g. LinkedIn, UCP GitHub #469) | `shoop.world` | Apex; equity consolidates via 301 **if** crawlers follow |

**Policy:** any **link** we publish externally (bios, press, GitHub, ads, partner filings) should be the full canonical:

```text
https://www.shoop.world
```

Bare `shoop.world` in prose is acceptable as a name; do not publish `http://…`, apex-only `https://shoop.world/…` path URLs, or Railway preview hosts as public entry points.

### Out of scope

`shoop.ai` resolves to a GoDaddy parking lander (`/lander`). It is **not** the Shoop product origin and must not be used in external links.

---

## Re-check commands

```bash
# Use GET — apex HEAD returns 405
for u in \
  https://shoop.world/ https://www.shoop.world/ \
  http://shoop.world/ http://www.shoop.world/
do
  curl -sI -X GET --max-redirs 0 -A "Mozilla/5.0" "$u" | sed -n '1p;/^[Ll]ocation:/p'
  echo "--- $u"
done
```

Pass criteria: apex → **301** to www HTTPS; www HTTP → **301** to HTTPS; www HTTPS → **200**; no temporary redirect codes on that path.
