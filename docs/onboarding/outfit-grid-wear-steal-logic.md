# Onboarding outfit grids: “wear most” → “closet you’d steal”

> **Audience:** another AI / engineer reviewing this system for improvements.  
> **Full onboarding field inventory:** [`onboarding-flow.md`](./onboarding-flow.md).  
> **Source of truth:** `src/lib/onboarding/outfit-grid.ts`, `src/app/api/onboarding/taste/route.ts`, `src/components/onboarding/OnboardingGate.tsx`, `src/components/onboarding/TasteOutfitGridStep.tsx`, `src/lib/onboarding/taste-persist.ts`, `src/lib/onboarding/style-mix.ts`.  
> **Date of capture:** 2026-07-29.

---

## 1. Product intent (what these steps are for)

Two consecutive taste-elicitation screens inside onboarding:

| Order | UI copy | Internal mode | Max picks | Why (shown under grid) |
|------|---------|---------------|-----------|------------------------|
| 1 | **“Which three did you actually wear most this month?”** | `worn` | **3** | “Your real wardrobe is my starting point. The dream comes next.” |
| 2 | **“Whose closet would you steal?”** | `aspirational` | **2** | “Where you're headed matters as much as where you are. I dress both.” |

Subtitles:

- **Worn:** “Not the fantasy... the reality. No judgment, this is a safe space for that hoodie.”
- **Aspirational:** “No guilt... stealing is just wanting with style. Pick two.”

**Design thesis:** worn = who they are today (higher weight downstream); aspirational = who they’re becoming (steers “heading toward”). Both are **visual multi-select grids** of catalog product images with vibe labels — not free text, not swipe, not upload-your-closet.

---

## 2. Where they sit in the onboarding flow

Taste rail substeps (strict order):

```
spend → worn → aspirational → loves → compliments → honesty
```

Upstream context already collected before these grids load:

- Identity: `preferredName`, `genderPresentation`, DOB/style era, `lifestyleTags`
- Location: `shippingCountry`, `currency`
- Spend: `budgetPhilosophies` → sent as `valuePhilosophy`
- Optional early brands if already set: `brandLikes`, `brandAvoids`

Immediately after these two steps, picks feed:

1. **Loves/vetoes chip ranking** (`loves-vetoes-suggest.ts`) via `wornLabels`, `aspirationalLabels`, `wornTasteTags`, `aspirationalTasteTags`
2. On taste finish: **persist** → `tasteTags` + `styleMix` on profile
3. Later: fashion memory seeding / chat personalization

---

## 3. End-to-end pipeline (one deck build)

```
Client enters worn|aspirational substep
  → GET /api/onboarding/taste?mode=...&context...
    → merge query params with saved profile / brand prefs
    → buildOutfitGridDeck(ctx)
         ├─ Parallel:
         │    A) llmOutfitSlots(ctx)  → 9 {label, searchQuery, tasteTags}
         │       (fallback: hardcoded gender×mode slot lists if LLM fails / bad JSON)
         │    B) accessTokenForCatalogMcp()
         ├─ For each slot (concurrency 3):
         │    searchCatalog(searchQuery, filters) → products with images
         │    if empty: retry with first 5 words of query
         ├─ Assign first unused product per slot → OutfitGridCard
         ├─ Fill empty slots from leftover hits (keep original slot label)
         └─ Last resort: simplified query = audience + first 2 tasteTags|label
  ← JSON { deck[], contextUsed, source: "shopify_catalog" }
Client shows carousel; user selects ≤ maxPicks
On aspirational fetch: pass worn pick labels as wornLabels (dedupe signal to LLM)
On taste complete: POST picks → tasteTags + styleMix
```

**Important:** decks are **live catalog searches**, not a static CDN of outfit photos. Card `id` is usually the Shopify product id. Selections are cleared whenever personalization inputs change or when re-entering a grid step (stale product ids must not carry over).

---

## 4. Model & LLM call

| Setting | Value |
|---------|--------|
| Helper | `createLightweightMessage` (`src/lib/ai-chat/anthropic.ts`) |
| Model | `AI_CHAT_LIGHTWEIGHT_MODEL` → env override or default **`claude-haiku-4-5-20251001`** |
| `max_tokens` | `900` |
| `temperature` | `0.4` |
| Retries | Lightweight path retries on 529 / overload / rate_limit (400ms, 1200ms) |
| Failure mode | Log `onboarding_outfit_slots_failed`; use **static fallback slots** (still search catalog) |

There is **no vision model**. The LLM only proposes text search slots; images come entirely from Shopify catalog search results.

---

## 5. Exact prompts

### 5.1 System prompt (verbatim)

```
You generate fashion outfit search slots for a shopping onboarding grid.
Return ONLY JSON: {"slots":[{"label":"short vibe label","searchQuery":"catalog search query","tasteTags":["tag"]}]}.
Exactly 9 slots. Labels are 2–4 words, lowercase-friendly. searchQuery must include audience (${aud}) and garment words Shopify can match.
No markdown.
```

Where `${aud}` is from `audiencePhrase(genderPresentation)`:

| `genderPresentation` | audience phrase |
|----------------------|-----------------|
| `feminine` | `women's` |
| `masculine` | `men's` |
| `androgynous` / `nonbinary` | `gender-neutral` |
| else / prefer not to say | `""` in helpers; prompt uses **`unisex`** if empty |

### 5.2 User message

The user message is **`JSON.stringify(userPayload)`** — not natural language. Shape:

```json
{
  "mode": "worn" | "aspirational",
  "purpose": "<mode-specific string>",
  "audience": "women's" | "men's" | "gender-neutral" | "unisex",
  "genderPresentation": string | null,
  "styleEra": string | null,
  "lifestyleTags": string[],
  "valuePhilosophy": string | null,
  "brandLikes": string | null,
  "brandAvoids": string | null,
  "avoidDuplicateLabels": string[]
}
```

**Purpose strings (verbatim):**

- `worn`: `"real outfits they actually wear most days — everyday reality, not fantasy"`
- `aspirational`: `"aspirational closet looks they would steal — elevated, dream wardrobe"`

**`avoidDuplicateLabels`:** only meaningful for aspirational — client sends labels of worn picks so the LLM is steered away from duplicates. There is **no hard filter** in code that drops aspirational slots matching worn labels; it’s prompt-only.

### 5.3 Expected LLM output schema

```json
{
  "slots": [
    {
      "label": "string",
      "searchQuery": "string",
      "tasteTags": ["string"]
    }
  ]
}
```

Parser also accepts a bare array, or `query` instead of `searchQuery`.

**Validation / clamping:**

- Need **≥ 6** valid slots or parse fails → fallback
- Cap at **9** slots
- `label` max 48 chars; `searchQuery`/`query` max 160
- `tasteTags`: strings only, lowercased, max 40 chars each, max 6 tags per slot

---

## 6. Context fields & attributes (inputs)

### 6.1 `OutfitDeckContext` (server)

| Field | Type | Role |
|-------|------|------|
| `mode` | `"worn" \| "aspirational"` | Purpose + fallback table |
| `genderPresentation` | string? | Audience phrase + fallback gender branch |
| `styleEra` | string? | LLM personalization (often CSV of era values like `23_29`, `30s`) |
| `lifestyleTags` | string[]? | LLM personalization (e.g. `campus_life`, `deep_in_career`) |
| `valuePhilosophy` | string? | Spend habit from spend step / profile |
| `brandLikes` | string? | Comma-joined loves (query or brand prefs) |
| `brandAvoids` | string? | Comma-joined avoids |
| `shippingCountry` | string? | → `ships_to.country` + `address_country` |
| `currency` | string? | Catalog context currency |
| `wornLabels` | string[]? | Aspirational dedupe hint to LLM |

### 6.2 Client → GET query params

Built in `OnboardingGate.loadOutfitDeck`:

- `mode`, `genderPresentation`, `styleEra` (joined CSV of selected eras), `lifestyleTags` (CSV), `valuePhilosophy` (joined budget philosophies), `brandLikes`, `brandAvoids`, `shippingCountry`, `currency`
- If `mode === "aspirational"` and worn picks exist: `wornLabels` = CSV of worn pick labels

### 6.3 Server merge rules (`GET` handler)

Query param wins if present; else fall back to:

- Profile: `genderPresentation`, `styleEra`, `lifestyleTags`, `valuePhilosophy`, `shippingCountry` / `country`, `currency`
- Brand prefs: love/like → `brandLikes`; avoid/hate → `brandAvoids`

Response includes `contextUsed` (resolved ctx) for debugging.

### 6.4 Gender / era value vocab (upstream form)

`genderPresentation` options: `masculine` | `feminine` | `androgynous` | `nonbinary` | `prefer not to say`

Style era values: `13_14`, `15_17`, `18_22`, `23_29`, `30s`, `40s`, `50s_60s`, `65_plus`

Budget / value philosophy values: `best_value`, `premium`, `luxury`, `deal_hunter`, `design_first`

---

## 7. How images are fetched

### 7.1 Catalog search

- Auth: `accessTokenForCatalogMcp()`
- API: `searchCatalog(accessToken, query, filters, { context, limit: 10, signal })`
- Tool name under the hood: Shopify MCP `search_catalog`
- Intent string: `` `onboarding outfit grid — ${slot.label}` `` (and `fallback` / `refill` variants)

**Filters:**

```ts
{ available: true, ships_to?: { country }, shop_ids?: sampleCuratedShopIds(100) }
```

When curated shop allowlist is enabled, shops are **stride-sampled to 100** so onboarding does ~1 MCP cohort per query instead of fan-out across the full allowlist.

**Context:**

```ts
{ address_country?: ISO2, currency?: string, intent: string }
```

### 7.2 Image URL extraction

`extractCatalogImageUrl(product)` — first available of:

1. `media[]` item urls (`url` / `src` / `href` / `preview.url` / `preview.src`)
2. `featured_image`
3. `image`

Products without a resolvable image are dropped before slot assignment.

### 7.3 Assignment & fill strategy

1. Concurrent search per slot (concurrency **3**)
2. First product whose id not yet used → card
3. Unused hits kept as leftovers
4. Empty `imageUrl` slots filled from leftovers (**label stays the slot’s vibe label**, even if product is from another query)
5. Still empty → simplified query: `[audience, first 2 tasteTags or label].join(" ")`
6. If still no image → placeholder card with empty `imageUrl` (UI shows gradient)

### 7.4 What the user actually sees

- Horizontal snap carousel (~3 cards visible), product photo as full-bleed cover
- Overlay: vibe `label` (not product title)
- Selection tray thumbnails (max 3 / 2)
- No product title, price, or brand shown on the card face

**Critical product/UX implication for reviewers:** the LLM asks for “outfit” queries, but the catalog returns **individual product listing photos**. The system does **not** compose multi-garment outfits, does not use lookbook imagery, and does not verify that the photo depicts a full outfit matching the label.

---

## 8. Card & pick data shapes

### 8.1 Deck card (`OutfitGridCard`)

| Field | Meaning |
|-------|---------|
| `id` | Product id (or `slot:mode:index:label` placeholder) |
| `productId` | Same product id (empty if placeholder) |
| `label` | LLM/fallback vibe label |
| `title` | Catalog product title |
| `imageUrl` | Extracted catalog image URL |
| `tasteTags` | From slot (LLM or fallback) |
| `searchQuery` | Query that produced the slot (client does not need it for display) |
| `mode` | `worn` \| `aspirational` |

GET response strips to: `id`, `productId`, `label`, `title`, `imageUrl`, `tasteTags`, `mode`.

### 8.2 Persisted pick (`OutfitPick` on POST)

```ts
{
  id: string;           // card/product id
  label: string;        // vibe label — primary signal
  tasteTags?: string[];
  productTitle?: string; // from card.title
  productId?: string;
}
```

Limits: worn ≤ 6 in API schema (UI caps at 3); aspirational ≤ 4 in API (UI caps at 2).

---

## 9. Static fallback slots (when LLM fails)

Hardcoded 9 slots × gender (masculine vs non-masculine) × mode. Examples:

**Worn feminine:** jeans + knit, blazer day, slip skirt, all black, athleisure, shirt dress, linen set, denim on denim, romantic blouse  

**Worn masculine:** jeans + knit, blazer day, tee + chino, all black, athleisure, oxford shirt, linen set, denim on denim, tailored trousers  

**Aspirational feminine:** quiet-luxury airport, French-girl café, sequin party, minimalist gallery, boho festival, street-sharp, classic tailored, athleisure-clean, romantic garden  

**Aspirational masculine:** quiet-luxury airport, Italian café, black-tie adjacent, minimalist gallery, festival weekend, street-sharp, classic tailored, athleisure-clean, coastal linen  

Each has a canned `searchQuery` and `tasteTags`. Non-masculine / androgynous / prefer-not-to-say uses **feminine** fallback tables.

---

## 10. Downstream use of picks

### 10.1 `buildPatchFromTastePicks`

For each pick, emit positive `tasteTags` with category `worn` or `aspirational` from:

1. pick `label`
2. pick `tasteTags[]`
3. tokens from `productTitle` (len 4–23, up to 4 tokens)

### 10.2 `computeStyleMix` (Shooping Cart)

Keyword-score labels/tags onto axes: Parisian, Minimal, Romantic, Street, Classic, Sporty, Boho, Bold.

Weights:

- Worn labels: **×3**
- Aspirational labels: **×2**
- Taste tags: **×1**
- Compliments: **×1.5**

Top 3 axes → percents summing to 100.  
`headingToward`: first compliment mapping, else capitalize first aspirational label.

### 10.3 Loves / vetoes suggestions

Worn + aspirational labels/tags become scoring signals for ranked brand/veto chips on the next step.

---

## 11. Known constraints / failure modes (useful for improvement brainstorming)

1. **Product photos ≠ outfits.** Biggest semantic gap vs copy promising “outfits you wear” / “closet you’d steal.”
2. **Prompt-only personalization.** `styleEra`, lifestyle, brands, spend influence LLM text only — no ranking/re-scoring of catalog hits by those attributes after search.
3. **Aspirational dedupe is soft.** `avoidDuplicateLabels` is not enforced post-LLM.
4. **Leftover fill can mismatch label.** Empty slot may show a product from another query while keeping the original vibe label.
5. **Gender fallback bias.** Unknown / prefer-not-to-say / androgynous → feminine static fallbacks (LLM gets `gender-neutral` / `unisex`, but fallbacks don’t).
6. **No quality scoring of results.** First image-bearing product wins; no brand fit, aesthetic match, or “looks like an outfit” filter.
7. **9 slots fixed; user only picks 3 then 2.** Diversity of the 9 matters more than depth.
8. **No caching** of decks across sessions; every entry hits LLM + up to 9 (+refills) catalog searches.
9. **Shop sample of 100** may miss shops that would better match a vibe.
10. **UI does not require exactly 3 / 2** — it caps max; empty selection can advance depending on advance rules (review UX gating if forcing signal quality).
11. **Vision unused.** Could score or caption images, but currently doesn’t.
12. **Temperature 0.4** on Haiku — slot diversity vs stability tradeoff not tuned with evals in-repo.

---

## 12. File map

| Path | Responsibility |
|------|----------------|
| `src/lib/onboarding/outfit-grid.ts` | LLM slots, fallbacks, catalog deck build |
| `src/app/api/onboarding/taste/route.ts` | GET deck + POST persist |
| `src/components/onboarding/OnboardingGate.tsx` | Step order, fetch params, pick state, copy |
| `src/components/onboarding/TasteOutfitGridStep.tsx` | Carousel UI |
| `src/lib/onboarding/taste-persist.ts` | Picks → tasteTags + styleMix patch |
| `src/lib/onboarding/style-mix.ts` | Axis scoring from labels |
| `src/lib/onboarding/loves-vetoes-suggest.ts` | Next-step chip ranking from picks |
| `src/lib/shopify/catalog.ts` | `searchCatalog`, `extractCatalogImageUrl` |
| `src/lib/ai-chat/constants.ts` | `AI_CHAT_LIGHTWEIGHT_MODEL` |

---

## 13. Prompt for an improvement-review AI

Paste this when asking for redesign ideas:

> Review the Shoop onboarding outfit-grid system documented above (`worn` = “which three did you actually wear most”, `aspirational` = “whose closet would you steal”). Propose concrete improvements prioritized by: (1) signal quality for personalization, (2) visual honesty vs “outfit” framing, (3) latency/cost, (4) fairness across gender presentation. Prefer changes that fit the existing stack (Anthropic Haiku + Shopify catalog MCP) unless a new dependency clearly wins. Call out what to keep. Include eval ideas and migration risk.

---

## 14. Quick reference — exact strings the user sees

```
Title: Which three did you actually wear most this month?
Subtitle: Not the fantasy... the reality. No judgment, this is a safe space for that hoodie.
Why: Your real wardrobe is my starting point. The dream comes next.
Max picks: 3

Title: Whose closet would you steal?
Subtitle: No guilt... stealing is just wanting with style. Pick two.
Why: Where you're headed matters as much as where you are. I dress both.
Max picks: 2
```
