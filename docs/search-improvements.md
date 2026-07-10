# Shoop — Search & Curation Pipeline: Master Implementation Prompt

> Paste this whole document into Cursor as the task spec. It describes how to rebuild Shoop's
> product search + curation pipeline on top of the Shopify UCP Global Catalog, including a new
> gift-direction selection flow. Read the **Constraints** and **How Shopify UCP Works** sections
> before writing any code — most bugs in this area come from misunderstanding the API's response shape.

---

## 0. Role & Objective

You are working inside the existing **Shoop** codebase. Do **not** re-architect anything outside the search/curation path. Reuse existing primitives.

Your objective: implement a multi-query, self-ranked, availability-verified search pipeline that:

1. Interprets the user's request into one of four **archetypes** - these are the update for the current modes (judge, copilort, etc.).
2. For under-specified gifts, runs a **two-step direction flow** (ask interests → user picks x number of directions).
3. Fans out **multiple parallel queries** per request instead of one.
4. Applies the correct **filters** on every query and handles **budget** intelligently (incl. controlled overage).
5. Pools + de-duplicates results and **re-ranks them with Shoop's own scoring** (not Shopify's order).
6. **Verifies the exact variant is really buyable** before showing it.
7. Returns results **within a 6-second SLA** by splitting fast (in-SLA) and deep (post-SLA) work.
8. **Learns** from outcomes to improve future searches.

---

## 1. Hard Constraints (do not violate)

- **6-second SLA**: from the moment search starts to first picks rendered, max 6s. Anything slower must be moved to a post-SLA streaming phase.
- **No caching of catalog results**: Shopify prohibits it. Pools are per-request, recomputed each time.
- **Honesty in UI copy**: any budget overage, small-shop pick, or relaxed constraint must be stated plainly on the pick card.

---

## 2. How the Shopify UCP Global Catalog Actually Works (read carefully)

Endpoint: `https://catalog.shopify.com/api/ucp/mcp`. Every request must include `meta.ucp-agent.profile`. Three tools:

- **`search_catalog`** — keyword/similarity search across all merchants.
- **`get_product`** — full product detail with variant selection (this is the verification tool).
- **`lookup_catalog`** — look up by known product/variant ID.

### 2.1 Request shape

All params are wrapped in a `catalog` object:

```json
{
  "catalog": {
    "query": "trail running shoes",
    "like": [{ "id": "gid://shopify/p/..." }], // optional: similarity / "more like this" (1–2 items, or base64 image)
    "filters": {
      "available": true,
      "condition": ["new"],
      "ships_to": { "country": "US" },
      "ships_from": { "country": "US" },
      "shop_ids": ["gid://shopify/Shop/..."],
      "categories": ["gid://shopify/TaxonomyCategory/123"],
      "price": { "min": 5000, "max": 20000 } // MINOR UNITS (cents), in context.currency
    },
    "context": {
      "address_country": "US",
      "currency": "USD",
      "language": "en",
      "intent": "Customer training for first ultramarathon, prefers max cushioning"
    },
    "pagination": { "limit": 50, "cursor": "<opaque>" }
  }
}
```

### 2.2 The filter set is SMALL and fixed

The **only** filters that exist (base UCP + Shopify extension combined):
`available`, `condition` (new/secondhand), `ships_to`, `ships_from`, `shop_ids`, `categories`, `price`.

**There is NO filter for size, color, material, style, gender, or dimensions.** This is critical. Those are handled in the query text (soft) and in post-retrieval variant selection (hard). Do not attempt to filter by them server-side — it's not supported.

- `categories` requires a Shopify **taxonomy GID**, which you don't know up front. Discover it: run a query _without_ a category filter, read the `categories` field off returned products, then optionally re-query with the discovered GID. Maintain a cached name→GID map in `shopifyTaxonomyMap.ts`. **If unsure of the GID, omit `categories`** — a wrong category filter silently returns zero good results.
- `price.min/max` are in **minor units** (cents) and denominated in `context.currency`.

### 2.3 `context` steers, it does not enforce

`context.intent`, `address_country`, `currency` influence relevance ranking and localization. The server **may ignore or down-rank** context. Never put a hard requirement in `intent` expecting enforcement — that's what `filters` are for. Keep `intent` non-identifying.

### 2.4 There is NO sort parameter

Results come back ranked by Shopify's opaque text-relevance algorithm (when `query` is present). You cannot ask for "cheapest first" or "highest rated." **All sorting Shoop does is client-side, over the pool we retrieve.** Without a `query` it becomes a filter-only "browse" with no relevance ranking — avoid that; always pass a `query`.

### 2.5 Pagination + the 1,000 ceiling

- `limit`: default 10, **max 50** per call. It's a _requested_ size; the response may return fewer — never assume length == limit.
- Cursor-based: copy `pagination.cursor` from the response into the next request's `catalog.pagination.cursor`. The cursor is **opaque** — never parse or build it. Keep query/filters identical across pages.
- You can paginate to a **max depth of 1,000 results** - or until`has_next_page` is `false`; past that, `has_next_page` is `false` regardless of matches.
- `total_count` is an **estimate** of total matches (can exceed 1,000) — do **not** use it for exact page math.
- **Breadth beats depth**: to avoid missing good products, fire several differently-phrased queries (each shallow, 1–2 pages) and union them, rather than paging one query deep. A product buried on query A's phrasing often ranks top on query B's. Same call budget, far better recall.

### 2.6 Response shape — `options` vs `variants` (the #1 source of bugs)

Products are clustered by **UPID** (same product across merchants = one cluster with multiple offers).

**`options`** = the axes of choice (the configurator menu): `[{name:"Color", values:[{label:"Black"}, ...]}, {name:"Size", values:[{label:"M"}, ...]}]`.

**`variants`** = concrete sellable SKUs, each a specific combination: `{id:"gid://.../ProductVariant/123", sku, title:"Black / M", price:{amount,currency}, checkout_url, condition, eligible:{native_checkout}, availability:{available,status,running_low}, requires:{shipping,components}, seller:{...}, options:[{name:"Color",label:"Black"},{name:"Size",label:"M"}]}`.

**CRUCIAL difference between the two tools:**

- In a **`search_catalog`** response, option values are **bare labels only** — `{"label":"M"}`. There is **no `available`/`exists` flag**, and the `variants` array typically contains only **one featured variant**. So search results tell you a product _advertises_ Black and M, but NOT whether _Black/M specifically_ exists, is in stock, or is buyable.
- In a **`get_product`** response (when you pass `selected`), option values are **resolved**: `{"label":"M","available":false,"exists":true}`, with `available`/`exists` computed against the current selection. This is the only place you learn true per-variant availability.

Therefore: **you cannot confirm "the exact variant the user needs" from search alone. You must call `get_product` to verify.** - unless the intended variant is the featured onw, then its availability is within search_catalogue (See Stage 4.)

- `price_range` is product-level (min/max across variants). Real price lives on `variant.price`. Always read the matched **variant's** price for budget checks, not the range.
- `metadata.attributes` (e.g. Material/Style/Occasion), `metadata.tech_specs`, `metadata.top_features`, `metadata.unique_selling_points` are **ML-inferred** — useful as ranking signals and for matching qualitative intent, but variable accuracy and sometimes absent. Never treat as ground truth; always null-handle.
- `variant.eligible.native_checkout` (bool) tells you if the non-redirect checkout path is supported — feed your Rye-first ladder.

### 2.7 `get_product` selection

```json
{
  "catalog": {
    "id": "gid://shopify/p/...",
    "selected": [
      { "name": "Color", "label": "Black" },
      { "name": "Size", "label": "M" }
    ],
    "preferences": ["Size", "Color"] // relaxation order if exact combo unavailable
  }
}
```

Returns resolved option `available`/`exists` flags + the matching variant with its real `availability`, `price`, and `eligible.native_checkout`.

---

## 3. Pipeline Overview & the 6s Time Budget

| Time            | Phase          | Work                                                                                                                               |
| --------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **T+0**         | Launch         | search starts. Fire **wave-1 template queries** immediately (no LLM). Launch Haiku query-planner **in parallel**.                  |
| **T+0 → ~1.5s** | Wave 1 returns | Parallel `search_catalog` results (~150–400ms each from US region) + Haiku portfolio returns (keep output tiny).                   |
| **~1.5 → 2.8s** | Wave 2         | Fire Haiku's crafted queries; batch-embed partial pool via Voyage (parallel, soft deadline).                                       |
| **~2.8 → 3.0s** | Pool           | Union, de-dupe by UPID, drop curation exclusions, run composite scoring (pure compute, ~10ms).                                     |
| **~3.0 → 3.6s** | Verify         | Parallel `get_product` on top ~12 candidates.                                                                                      |
| **~3.6 → 5.5s** | Fast curate    | **Haiku** assigns slots + writes one-line hooks (small output). Picks **stream to client** → SLA met.                              |
| **Post-SLA**    | Deep enrich    | **Opus (thinking)** streams richer per-pick reasoning, may _append_ a wildcard. **Never reorders/removes** already-rendered picks. |

Key rule: **the math (scoring) does the heavy lifting; Haiku judges fast; Opus narrates after.** Emit a `narration_line` SSE event at each phase so the wait feels productive.

Validate every stage latency against `api_logs.duration_ms`. The binding constraint is the **fast-curator output token count** — keep its response contract minimal.

---

## 4. Stage 0 — Interpretation (happens in the chat turn, before the SLA clock)

The chat model already runs before search starts, so do the expensive interpretation here. **Enrich the readiness of search**

we need to have something like
archetype: "specific" | "broad" | "gift_directed" | "gift_vague", // these are like the new modes

search_brief: {
category, use_case,
must_haves: string[],
nice_to_haves: string[],
budget: { amount: number | null, type: "hard" | "soft" | "none", currency: "USD" }, // add to the budget slider option to select, strict, or soft
variant_constraints: { size?: string, color?: string, other?: Record<string,string> },
gender_scope: "mens" | "womens" | "unisex" | "unknown", // read/write user_profiles.gender
recipient: { kind: "self" | "other", label?: string, known_interests?: string[] },
ranking_profile: "relevance_first" | "balanced" | "value_first" | "gift_diversity"
}

- Inject scope-matched memory into the chat prompt so known sizes/brands/recipient facts pre-fill the brief.
- `gender_scope`: read from `user_profiles.gender`; if newly learned, write it back. Apply to the **query/scope**, never to the recipient if shopping for someone else.
- Multi-intent requests ("shoes and a jacket") → set archetype per intent and emit **separate briefs**; the search route runs separate portfolios and groups results. Never blend intents into one query.

---

## 5. Gift Direction Flow (mode update)

When `archetype === "gift_vague"` and we lack a usable direction:

**Step A — ask what the recipient is into (one conversational question).**. Example: _"Tell me a bit about your brother — what's he into lately, and what's the occasion?"_ Skip this step if memory already holds recipient interests.

**Step B — propose directions to choose from.**

example
propose_gift_directions.input = {
recipient_label: string, // "your brother"
context_summary: string, // "into tech, works from home, birthday"
directions: Array<{
// 4–6 options, derived from interests
id: string; // "desk_accessories"
label: string; // "Desk accessories"
rationale: string; // "he works from home"
}>,
pick_count: 2, // ask the user to choose min 1 max 3
};

Client chat renders these as **multi-select chips** ("Select x directions to explore"). This mirrors the existing filter-chip UI. On submit, the client posts the selected direction IDs back as a normal user message (e.g. `__gift_directions__: desk_accessories, fitness`).

**Step C — search the chosen directions.** The chat model then searches with the 2 chosen directions as **two sub-briefs** (treated like multi-intent). The search route builds a separate query portfolio per direction and returns **two grouped result sets** so the user sees variety, not a blended list. Ranking profile = `gift_diversity` (see Stage 6).

Decision rule for vague gifts:

- Memory has recipient facts → skip to direction proposal (Step B) or straight to directed search.
- No facts + user gave _some_ anchor → propose directions directly (Step B).
- No facts + zero anchor → ask interests first (Step A), then Step B.

---

## 6. Stage 1 — Query Portfolio Construction

Build the portfolio (query crafting) (Haiku) + (deterministic templates for the instant wave-1).

**Every query, always:** `filters.ships_to={country:"US  - use user country"}`, `filters.available=true`, `context={address_country:"US  - use user country", currency:"USD  - use user currency", language:"en", intent:<qualitative story for THIS query>}`, `condition=["new"]` unless user signals secondhand. Add `price` only per budget rules (Stage 7). Add `categories` only with a confident GID.

**Portfolio shape by archetype:**

- **specific** ("adidas Germany kit 2026, size M"): 2–3 queries — exact phrasing; one synonym/reorder ("adidas Germany jersey 2026"); one slightly broadened. Size goes to `variant_constraints`, **not** the query. Ranking = `relevance_first`. Verification mandatory.
- **broad** ("black t-shirt"): 4–5 queries — gendered direct ("men's black t-shirt"), synonym ("black tee"), quality angle ("premium heavyweight black t-shirt"), value angle, + **one discovery query** with adjacent vocabulary ("relaxed cotton crew black") to surface hidden gems. Ranking = `balanced`/`value_first`.
- **gift_directed** ("romantic gift for my wife"): decompose across gift sub-categories (jewelry, personalized, cozy/luxury, experience-adjacent), each its own `intent`. Ranking = `gift_diversity`. Apply **recipient** memory, NOT the user's own taste vector.
- **gift_vague** post-direction-selection: one sub-portfolio per chosen direction; grouped output.

Keep each query single-intent, core noun + 2–4 strong attributes; don't stuff (over-long queries muddy the relevance embedding the same way multi-intent does).

**Category discovery** (optional tightening): if a broad query returns mixed categories, read the dominant `categories` GID off results and fire one tightened re-query. Cache the name→GID mapping.

---

## 7. Budget Logic

Classify `budget.type` at interpretation:

- **hard** ("strictly under $50"): set `filters.price.max = 5000`. No overage. Ever.
- **soft** ("around $50"): set the **retrieval** filter generously (`price.max ≈ 1.15 × target`) so good slightly-over items enter the pool. Then enforce the **earn-the-overage rule at ranking**: an over-budget candidate (cap ~10% over) may outrank in-budget ones **only if** its composite score beats the best in-budget candidate by a margin `δ`. If shown, the pick card must say so: _"8% over budget — but 4.8★ (2,100 reviews) vs 4.1★ for anything under."_
- **none**: no price filter; let value scoring handle it.
- **gift floor**: for gifts, apply a soft penalty to items priced under ~30% of the gift budget (reads as a cheap miss) — penalty, not a hard filter.

---

## 8. Stage 2 — Retrieval & Pool Assembly

1. Fire all portfolio queries **in parallel**, `limit: 50`, page 1 (page 2 only if a query returns a thin set and time allows).
2. Union all results; **de-duplicate by UPID** (across queries the same product recurs).
3. Track, per surviving candidate, **which queries surfaced it and at what rank** (needed for the corroboration signal).
4. A user searches, Shoop shows them a set of products, and then the user says "show me more" or "none of these, try again." That second search is called a refine round (or "show more" round). The problem it's solving: when you search again, you don't want to show the same products you already showed. That would feel broken — like the assistant has amnesia. So before presenting the new results, Shoop removes any product it already showed earlier in this conversation.
5. Thin pool (<5 after exclusions)? **Widen within Shopify only** — there is no external fallback. In priority order: (a) fire 1–2 **broader re-queries** (drop the narrowest attributes / relax to the parent category); (b) **drop `price.max`** if a budget filter is starving the pool (results enter as `loosened`); (c) page to page 2 on the queries that returned the most relevant hits. All stays inside `search_catalog`. If still thin after widening, present the few honest survivors and say so ("only a handful match — here's what's actually available") rather than padding with weak matches.

---

## 9. Stage 3 — Scoring (Shoop's own ranking over the pool)

Pure compute, runs in ~10ms. For each candidate:

```
Score = w_r·RelPrior + w_q·Quality + w_p·Popularity + w_v·Value + w_f·Fit + w_g·Gem − Penalties
```

- **RelPrior** = best rank across source queries, decayed `1/log2(1+rank)`, **+ corroboration bonus** for each additional portfolio query that returned the same UPID (cross-query agreement = robust relevance).
- **Quality** = Bayesian-adjusted rating `(n·R + m·C)/(n + m)`, prior mean `C≈4.2`, pseudo-count `m≈20`. Kills the "5.0 from 3 reviews" trap. Missing rating (inferred field may be absent) → neutral prior + **ineligible for hero slot**.
- **Popularity** = `log10(1 + review_count)`, normalized.
- **Value** = quality z-score − `β · price_percentile_within_pool`; `β` scales with user price sensitivity. (Quality-per-dollar, never "cheapest".)
- **Fit** = cosine(candidate embedding, scope-matched taste vector) blended with deterministic `metadata.attributes` hits (preferred brand/material/color +; previously-rejected attributes −). Embedding via Voyage batch (one call, soft deadline); if it misses, degrade Fit to attribute-match only. For gifts, use the **recipient** model, not the user's.
- **Gem** = bonus for high raw rating (≥4.5) with modest review count (~5–150) from non-mega sellers / surfaced by the discovery query.
- **Penalties** = per-seller cap (max 2 picks/shop) for diversity; hard-budget violations excluded outright; gift sub-floor penalty; rejection memory (`feedback_events`, `curated_picks.rejected`) heavy negative.

**Weights by `ranking_profile`** (tune later):

- `relevance_first` (specific): r .45, q .20, p .10, v .05, f .15, g .05
- `balanced` (broad): r .25, q .25, p .10, v .15, f .20, g .05
- `value_first`: r .20, q .20, p .10, v .30, f .15, g .05
- `gift_diversity`: recipient-fit .35, q .25, p .10, v .10, g .10 — and apply **MMR diversity** at slotting so picks aren't near-duplicates.

---

## 10. Stage 4 — Availability Verification ("really existing" gate)

This is mandatory and is the reason we verify ~12 to present ~6–8.

1. **Cheap pre-prune** using search-result option labels: if the user needs size M, the product's `options` must at least _list_ "M" (`exists`). Drop products that don't even advertise the needed value.
2. For the top ~25 scored candidates, call **`get_product` in parallel** with `selected` = the user's `variant_constraints` and a `preferences` relaxation order.
3. Require, for the matched variant:
   - it **exists** for the selected combination,
   - `availability.available === true && status === "in_stock"`,
   - `eligible.native_checkout` recorded (drives the Rye-first),
   - re-read the **variant** `price` (can differ from the featured variant; re-check budget here).
4. Failures **drop and backfill** from the next-ranked verified candidate.
5. The **hero pick always verifies**, even with no variant constraint — Shoop's #1 must never 404 or land on a sold-out page.
6. PDP open and add-to-cart **re-verify** live (caching is prohibited, so fresh truth is the only option anyway).

---

## 11. Stage 5 — Slotting & Presentation

After scoring + verification, assign distinct products to current slots:

- `shop_pick` — Haiku's judgment over the top-10 (feed it a **compressed** candidate list: ~40 tokens each — title, price, rating/count, key attributes, seller, gem flag).
- `most_popular` — max Popularity above a Quality floor.
- `best_value` — max Value above a Quality floor.
- **gem** — relax the Bayesian shrinkage: best Fit among high-raw-rating, low-review, small-seller candidates. Label honestly ("Small shop · 60 reviews · exactly your style").
- and then the others..
- Repeat-user "more like X" lane: `search_catalog` with `like:[{id: <endorsed/purchased GID>}]` + a keyword query.

Persist picks as `messages(content_type='picks')` + `curated_picks` rows (with `source_engine`, `native_checkout_url`, `upid`). Stream via existing SSE events (`narration_line`, `search_result`). Multi-round: re-runs pass prior picks as `excluded_product_keys`; pick types include `loosened`/`reframed` for relaxed rounds.

Each card states its one-line reason and any caveat (overage / small shop / relaxed constraint).

---

## 12. Degradation Rules (so the SLA survives bad luck)

- Thin pool after exclusions → **widen within Shopify only** (broader re-query → drop `price.max` → page 2). No external source. If still thin, show the honest few and say so.
- Budget filter starves pool → one relaxation re-query (drop `price.max`); results enter as `loosened` with honest framing.
- Variant constraint kills almost everything → show the few true survivors + close alternatives, framed "very few exist in M — here's what's actually buyable."
- Haiku planner times out → templates-only portfolio (wave-1).
- Voyage embeddings time out → Fit degrades to attribute-match only.
- Always emit `narration_line` per phase.

---

## 13. Stage 6 — Learning Flywheel

- **Query-yield telemetry**: log per source query `raw_count`, pool contribution, verification survival, and pick→endorse/purchase conversion. Nightly job folds this into per-category pattern weights — learned query angles replace guesses over time.
- **Recipient profiles**: extend memory extraction to tag fragments with a `subject. "Gift for wife" must retrieve the wife-model, not the user's.
- **Size/fit ledger**: confirmed purchases per category auto-apply as `variant_constraints` with a visible note ("size M, as usual").
- **Negative space**: extract rejection reasons (`feedback_events.reason`) into per-scope "avoid" sets feeding the Fit penalty.
- **Refine rounds**: "show me more" prefers a **fresh query angle** over deeper pagination; dedupe via `excluded_product_keys`.

---

## 14. Acceptance Criteria

1. **Specific** request with size: only variants that actually exist + are in stock + US-buyable are shown; hero never 404s.
2. **Broad** request: ≥4 distinct query angles fired in parallel; pool de-duped by UPID; at least one slot filled by a product surfaced only by the discovery query when one qualifies.
3. **Directed gift**: results show category variety (MMR), use recipient memory not the user's taste, never apply the user's own gender scope to the recipient.
4. **Vague gift**: Shoop asks about interests (if unknown), then presents selectable directions, user picks 2, and results come back grouped by the 2 chosen directions.
5. **Budget**: hard budget never exceeded; soft budget may show ≤10% overage only when it clears the margin, and the card states the overage.
6. **SLA**: p95 from search-start to first picks ≤ 6s (measured via `api_logs.duration_ms`); deep Opus reasoning streams after without reordering.
7. **Learning**: a second search for the same user reflects a previously confirmed size automatically and demotes a previously rejected product/attribute.

---
