# Share meta inventory

Every tag, image, and copy string crawlers see when someone pastes a Shoop URL. `{ORIGIN}` is `NEXT_PUBLIC_APP_URL` (then `APP_URL` / `VERCEL_URL` / `RAILWAY_PUBLIC_DOMAIN`, else `http://localhost:3000`).

**Production canonical origin:** `https://www.shoop.world`  
**Document title / brand string:** `Shoop — AI Shopping Concierge`

Machine-readable dump: [`values.json`](./values.json). Copy-paste HTML: [`html/`](./html/). Host redirect audit: [`host-canonical.md`](./host-canonical.md).

**Contents**

1. [What gets shared](#what-gets-shared)
2. [Brand constants](#brand-constants)
3. [Host + HTTPS canonical](#host--https-canonical)
4. [Main link (`/`)](#1-main-link-)
5. [Look link (`/ask/{token}`)](#2-look-link-asktoken)
6. [Instagram / WhatsApp / iMessage thumbnail](#instagram--whatsapp--imessage-thumbnail)
7. [Icons, PWA, viewport](#icons-pwa-viewport)
8. [JSON-LD](#json-ld)
9. [Robots + sitemap](#robots--sitemap)
10. [Other routes](#other-routes)
11. [Source map](#source-map)
12. [Gaps](#gaps)

---

## What gets shared

Only two public share surfaces exist.

| Surface | URL | Preview image | Indexable |
|---------|-----|---------------|-----------|
| **Main site** | `{ORIGIN}/` | Generated 1200×630 PNG (`/opengraph-image`) | yes |
| **Look / Ask card** | `{ORIGIN}/ask/{token}` | Try-on photo (`/api/ask/{token}/image`) | no (`noindex`) |

WhatsApp share body (not a meta tag — pasted as the message text):

```
Should I get it? Vote before you peek at Shoop’s take — {url}
```

Source: `src/lib/ask/share-client.ts` → `askShareMessage`.

Product pages, moodboard, profile, and chat threads are in-app. They are not share URLs with their own cards.

---

## Brand constants

From `src/lib/seo/site.ts`.

| Key | Value |
|-----|--------|
| `SITE_NAME` | `Shoop` |
| `SITE_TAGLINE` | `AI Shopping Concierge` |
| Default `<title>` / `og:title` / `twitter:title` | `Shoop — AI Shopping Concierge` |
| Title template (child routes) | `%s \| Shoop` |
| `SITE_DESCRIPTION` | `Shoop is your AI shopping concierge. Search every store, compare real products, and get honest buy, wait, or skip picks tailored to you.` |
| Locale | `en_US` (`<html lang="en">`) |
| Keywords | `AI shopping assistant`, `shopping concierge`, `product search`, `compare products`, `personalized shopping`, `buy recommendations`, `gift finder`, `online shopping help` |
| `og:type` | `website` |
| `twitter:card` | `summary_large_image` |
| Default OG path | `/opengraph-image` |

There is no `twitter:site`, `twitter:creator`, or `fb:app_id`.

---

## Host + HTTPS canonical

Full probe log: [`host-canonical.md`](./host-canonical.md). Summary (verified **2026-08-25**, `GET` only — apex `HEAD` returns 405):

| Check | Result |
|-------|--------|
| Canonical host | `https://www.shoop.world` (`link rel="canonical"`, `og:url`, `robots` `Host`, `sitemap.xml`) |
| Apex → www | **301 Moved Permanently** (`https://shoop.world` → `https://www.shoop.world`) |
| HTTP → HTTPS | **301** on both apex and www (`http://…` → `https://www.shoop.world/`) |
| Temporary redirects | None observed on the host matrix (no 302/307/308) |
| HSTS | **Set** on app responses: `max-age=63072000; includeSubDomains; preload` (`next.config.ts`) |
| App redirects | Middleware 301s `Host: shoop.world` → `www.shoop.world`; apex→www also at DNS/edge (GoDaddy); www HTTP→HTTPS is Railway |

**Authority rule:** publish and set `NEXT_PUBLIC_APP_URL` to `https://www.shoop.world` only. Bare `shoop.world` in prose is fine as a brand mention; crawlable / shareable URLs must use the www HTTPS form so we do not split authority with apex or HTTP variants.

`shoop.ai` is a separate parked GoDaddy domain — not the product origin.

---

## 1. Main link (`/`)

Merged from `rootMetadata()` (`src/app/layout.tsx`) + `createPageMetadata({ absoluteTitle, path: "/" })` (`src/app/(chat)/page.tsx`).

### Document

| Tag | Value |
|-----|--------|
| `<title>` | `Shoop — AI Shopping Concierge` |
| `meta name="description"` | SITE_DESCRIPTION |
| `meta name="application-name"` | `Shoop` |
| `meta name="creator"` | `Shoop` |
| `meta name="publisher"` | `Shoop` |
| `meta name="category"` | `shopping` |
| `meta name="keywords"` | comma-joined list above |
| `meta name="format-detection"` | `telephone=no, address=no, email=no` |
| `link rel="canonical"` | `{ORIGIN}` |
| `meta name="robots"` | `index, follow` |
| `meta name="googlebot"` | `index, follow, max-image-preview:large, max-snippet:-1` |

### Open Graph

| Tag | Value |
|-----|--------|
| `og:type` | `website` |
| `og:site_name` | `Shoop` |
| `og:locale` | `en_US` |
| `og:title` | `Shoop — AI Shopping Concierge` |
| `og:description` | SITE_DESCRIPTION |
| `og:url` | `{ORIGIN}` |
| `og:image` | `{ORIGIN}/opengraph-image` |
| `og:image:width` | `1200` |
| `og:image:height` | `630` |
| `og:image:type` | `image/png` |
| `og:image:alt` | `Shoop — AI Shopping Concierge` |

### Twitter / X

| Tag | Value |
|-----|--------|
| `twitter:card` | `summary_large_image` |
| `twitter:title` | `Shoop — AI Shopping Concierge` |
| `twitter:description` | SITE_DESCRIPTION |
| `twitter:image` | `{ORIGIN}/opengraph-image` (same PNG; `src/app/twitter-image.tsx` re-exports `opengraph-image`) |

Full HTML snapshot: [`html/home.head.html`](./html/home.head.html).

### Brand OG card (the PNG)

Generated at request time by `src/lib/seo/og-image.tsx` (`ImageResponse`, Satori). Not a static file in `public/`.

| Spec | Value |
|------|--------|
| Size | **1200 × 630** |
| Type | `image/png` |
| Alt | `Shoop — AI Shopping Concierge` (`src/app/opengraph-image.alt.txt`) |
| Routes | `/opengraph-image`, `/twitter-image` |
| Logo | `public/assets/shoop-logo.svg` inlined as data URI |
| Headline | SITE_TAGLINE (`AI Shopping Concierge`) |
| Body | `Your AI shopping concierge — real products, clear verdicts, no guesswork.` |
| Pills | `Search every store` · `Honest buy · wait · skip picks` · `Personalized to you` |
| Footer left | site host (`getSiteUrl().host`) |
| Footer right | `SHOOP` |
| Top bar | brand red `#E42831` |
| Background | gradient `page #F5F5F7` → `brandSoft #FDECEC` → white |

---

## 2. Look link (`/ask/{token}`)

`generateMetadata` in `src/app/ask/[token]/page.tsx`. Token is 10 chars (`base64url`). Friends land here from WhatsApp / copy-link.

`{asker}` = first word of the owner’s preferred name, else `"they"`.

### Document

| Tag | Live share | Missing token |
|-----|------------|---------------|
| `<title>` | `Should {asker} get it? · Shoop` | `Look not found · Shoop` |
| `description` | `Vote before you peek at Shoop’s verdict.` | `This Ask card isn’t available.` |
| `canonical` | `{ORIGIN}/ask/{token}` | same |
| `robots` / `googlebot` | `noindex, nofollow` | same |

### Open Graph + Twitter (live share)

| Tag | Value |
|-----|--------|
| `og:type` | `website` |
| `og:site_name` | `Shoop` |
| `og:locale` | `en_US` |
| `og:title` / `twitter:title` | `Should {asker} get it? · Shoop` |
| `og:description` / `twitter:description` | `Vote before you peek at Shoop’s verdict.` |
| `og:url` | `{ORIGIN}/ask/{token}` |
| `og:image` (metadata) | `{ORIGIN}/api/ask/{token}/image` |
| `og:image:alt` (metadata) | `{asker}'s try-on look` |
| `og:image` (file convention) | `{ORIGIN}/ask/{token}/opengraph-image` |
| `og:image:alt` (file convention) | `The look — should they get it?` |
| `twitter:card` | `summary_large_image` |
| `twitter:image` | `{ORIGIN}/api/ask/{token}/image` |

Look shares do **not** set `og:image:width` / `height` / `type` on the metadata image. The photo is the try-on JPEG as-is (portrait-ish), not the 1200×630 brand card.

Missing share falls back to the brand OG card. Snapshots: [`html/look.head.html`](./html/look.head.html), [`html/look-missing.head.html`](./html/look-missing.head.html).

### Look image pipeline

```
/ask/{token}  meta og:image
      ↓
/api/ask/{token}/image     ← durable same-origin URL (preferred in metas)
      ↓
resolveAskShareImageSrc()  ← re-signs private try-on storage (1h)
      ↓
302 to signed storage URL, or inline data: JPEG

/ask/{token}/opengraph-image   ← Next.js file convention; same bytes, so
/ask/{token}/twitter-image        /ask/{token} does not inherit the brand card
```

`publicAskImagePath` = `/api/ask/{token}/image`. Cache-Control on inline bytes: `public, max-age=300`. Upstream fetch for the file-convention route revalidates every 300s.

`robots.txt` disallows `/ask/` and `/api/`. Facebook / Instagram / WhatsApp / iMessage usually still fetch `og:image` URLs; Google Search will not index the page.

---

## Instagram / WhatsApp / iMessage thumbnail

There is **no** `ig:` meta tag and **no** dedicated 1080×1080 Instagram asset. Those apps read Open Graph:

| App | Title | Description | Thumbnail |
|-----|-------|-------------|-----------|
| Instagram (link sticker, DM, in-app browser) | `og:title` | `og:description` | `og:image` |
| WhatsApp | `og:title` | `og:description` | `og:image` |
| iMessage / Slack / Discord / LinkedIn | `og:title` | `og:description` | `og:image` |
| X / Twitter | `twitter:title` (fallback `og:title`) | `twitter:description` | `twitter:image` |

So:

- **Main link thumbnail** = 1200×630 brand PNG (`/opengraph-image`). Landscape 1.91:1 — the standard OG/Twitter size. Instagram feed posts prefer square 1080×1080; we do not generate that crop.
- **Look link thumbnail** = the try-on photo. Instagram will letterbox or crop a portrait look on some surfaces.

To inspect: paste the URL into [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/), [Twitter Card Validator](https://cards-dev.twitter.com/validator), or iMessage.

---

## Icons, PWA, viewport

Emitted on every page (root layout).

| Tag / field | Value |
|-------------|--------|
| `link rel="icon"` (file convention) | `/icon.svg` (`src/app/icon.svg`, 1024×1024, red `#E3100F`) |
| `link rel="icon"` (metadata) | `/assets/shoop-icon.svg` (`type="image/svg+xml"`) |
| `link rel="apple-touch-icon"` | `/assets/shoop-icon.svg` |
| JSON-LD `Organization.logo` | `{ORIGIN}/assets/shoop-logo.svg` |
| `apple-mobile-web-app-capable` | `yes` |
| `apple-mobile-web-app-title` | `Shoop` |
| `apple-mobile-web-app-status-bar-style` | `default` |
| Viewport | `width=device-width, initial-scale=1, viewport-fit=cover` |
| `theme-color` (viewport) | `#ffffff` |
| `color-scheme` | `light` |

### Web app manifest (`/manifest.webmanifest`)

`src/app/manifest.ts`

| Field | Value |
|-------|--------|
| `name` / `short_name` | `Shoop` |
| `description` | SITE_DESCRIPTION |
| `start_url` | `/` |
| `display` | `standalone` |
| `background_color` | `#ffffff` |
| `theme_color` | `#E3100F` |
| `lang` | `en` |
| `orientation` | `portrait-primary` |
| `categories` | `shopping`, `lifestyle`, `productivity` |
| `icons` | `/assets/shoop-icon.svg` (`sizes: any`, `purpose: any` + `maskable`) |

Brand red appears as two values in the wild: **`#E3100F`** (icon SVG + PWA theme) and **`#E42831`** (design tokens + OG card).

---

## JSON-LD

Injected once in the root layout body (`src/components/seo/SiteJsonLd.tsx`). Not route-specific.

```json
[
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Shoop",
    "url": "{ORIGIN}",
    "logo": "{ORIGIN}/assets/shoop-logo.svg",
    "description": "Shoop is your AI shopping concierge. Search every store, compare real products, and get honest buy, wait, or skip picks tailored to you."
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Shoop",
    "url": "{ORIGIN}",
    "description": "Shoop is your AI shopping concierge. Search every store, compare real products, and get honest buy, wait, or skip picks tailored to you.",
    "publisher": { "@type": "Organization", "name": "Shoop" }
  }
]
```

---

## Robots + sitemap

`src/app/robots.ts` → `{ORIGIN}/robots.txt`

```
User-Agent: *
Allow: /
Disallow: /api/
Disallow: /c/
Disallow: /ask/
Disallow: /profile
Disallow: /_next/
Sitemap: {ORIGIN}/sitemap.xml
Host: {ORIGIN}
```

`src/app/sitemap.ts` lists only `{ORIGIN}` (`changefreq: daily`, `priority: 1`). Look URLs are intentionally absent.

---

## Other routes

These set `createPageMetadata` but are **not** meant to be shared. All `noindex, nofollow`. OG/Twitter still fall back to the brand 1200×630 card unless noted.

| Path | Title | Description |
|------|--------|-------------|
| `/c/{id}` | `Conversation \| Shoop` | Your private shopping conversation with Shoop. Canonical currently falls back to `/` (no `path` passed). |
| `/moodboard` | `Moodboard \| Shoop` | My moodboard, The Hold, and My cart — looks you loved and what you're buying. |
| `/asks` | `Shared cards \| Shoop` | Looks you asked friends about — votes, notes, and Shoop’s take. |
| `/profile` | `Your profile \| Shoop` | Manage your Shoop shopping profile — sizes, tastes, budgets, and saved preferences. |

`/admin`, `/order/confirmed`, `/pre-checkout` inherit root metadata only (main-link titles + brand OG card). They do not declare their own share tags.

---

## Source map

| Concern | File |
|---------|------|
| Constants + `createPageMetadata` / `rootMetadata` / JSON-LD | `src/lib/seo/site.ts` |
| 1200×630 PNG renderer | `src/lib/seo/og-image.tsx` |
| Root layout metadata + viewport + JSON-LD mount | `src/app/layout.tsx` |
| Home page metadata | `src/app/(chat)/page.tsx` |
| Brand OG / Twitter image routes | `src/app/opengraph-image.tsx`, `src/app/twitter-image.tsx` |
| Look metadata | `src/app/ask/[token]/page.tsx` |
| Look OG / Twitter image routes | `src/app/ask/[token]/opengraph-image.tsx`, `twitter-image.tsx` |
| Durable look photo URL | `src/lib/ask/og-image.ts`, `src/lib/ask/ask-image.ts` |
| Look photo HTTP | `src/app/api/ask/[token]/image/route.ts` |
| WhatsApp / clipboard copy | `src/lib/ask/share-client.ts` |
| Favicon file convention | `src/app/icon.svg` |
| Public mark + wordmark | `public/assets/shoop-icon.svg`, `public/assets/shoop-logo.svg` |
| Manifest | `src/app/manifest.ts` |
| robots / sitemap | `src/app/robots.ts`, `src/app/sitemap.ts` |
| Host / HTTPS / published-authority audit | `docs/seo/host-canonical.md` |

Change copy or image size in `site.ts` / `og-image.tsx` — do not fork strings into route files.

---

## Gaps

Present in code / ops today; listed so this file stays honest.

- No Instagram-specific 1080×1080 (or 1080×1920 story) thumbnail.
- No `twitter:site` / `twitter:creator`.
- No `fb:app_id`.
- Look `og:image` has no width/height/type — some scrapers crop portrait try-ons poorly.
- Two brand reds: `#E3100F` (icon, PWA) vs `#E42831` (UI, OG card).
- Viewport `theme-color` is white; PWA `theme_color` is `#E3100F`.
- Apex forwarder returns **405** on `HEAD` (GET 301 is fine). DNS-level; not app-fixable.
- Some external bios still say bare `shoop.world` — prefer `https://www.shoop.world` for crawlable links.
