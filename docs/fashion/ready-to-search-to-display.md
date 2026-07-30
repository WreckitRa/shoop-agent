# Fashion flow: `ready_to_search` → finds on screen

> **Audience:** another AI / engineer reviewing this system for improvements.  
> **Scope:** fashion-memory chat pipeline **after** the router emits `ready_to_search`, through catalog retrieval, curation, and UI render.  
> **Not in scope:** router clarification / off-topic moves (see `docs/fashion/router.md`).  
> **Parallel system:** general AI-chat `runSearchEngine` (Voyage + tier judge) is a different path — this doc is **fashion-memory only**.  
> **Source of truth:** `src/lib/ai-chat/run-fashion-chat-stream.ts`, `src/lib/fashion-memory/**`.  
> **Date of capture:** 2026-07-29.

---

## 1. Product intent

Once the fashion router decides the brief is complete (`ready_to_search`), Shoop:

1. Turns the brief into a **multi-slot retrieval plan** (planner LLM)
2. **Fans out** Shopify catalog searches per slot
3. **Normalizes → hard-drops → scores → hydrates** (size/availability)
4. Runs a **vision-capable curator** that picks heroes / looks
5. Streams progress + finally renders a frozen **render contract** in chat

Modes (from brief `request_type` → plan `mode`):

| Mode | User intent | Deliverable on screen |
|------|-------------|------------------------|
| `single_item` | One garment | Hero picks (spread of options) |
| `outfit` | Head-to-toe for one occasion | Named looks (anchor + supports) |
| `capsule` | Rotation / wardrobe set | Mixable set + enumerated outfits |
| `multi_item` | Several unrelated garments | Independent slot picks |

---

## 2. High-level sequence (orchestrator)

Entry: `createFashionChatSseStream` in `run-fashion-chat-stream.ts`, branch when `routerResult.move === "ready_to_search"`.

```
ready_to_search + FashionSearchBrief
  │
  ├─ SSE fashion_pipeline { phase: "started" }
  ├─ narrate "Planning your search"
  ├─ resolve recipient person id (self if missing)
  ├─ fire-and-forget: writeRequestEventFromBrief (memory)
  │
  ├─ planSearchFromBrief(...)          → FashionSearchPlan
  │     SSE fashion_search_plan
  │     narrate "Exploring N angles…", "Searching stores"
  │
  ├─ loadFashionSearchProfile(...)
  ├─ accessTokenForCatalogMcp()
  ├─ searchFashionCatalogPlan(...)     → FashionCatalogSearchResult
  │     (phases below; onPhase → narration_line + preview/dropped images)
  │
  ├─ if curation: buildRenderContractWithTryon(...)
  ├─ metadata.fashionCatalogSearch = { …, render? }
  ├─ SSE fashion_catalog_search
  ├─ SSE fashion_pipeline { phase: "complete" }
  │
  ├─ OR early exit: budget_raise_ask → rewrite turn as ask_clarification
  │
  └─ stream assistant text (style_direction / garment)
        + brand_narration line if any
        + curation opening / thin_note
        + SSE fashion_curation (presentation)
```

**UI binding** (`MessageBubble.tsx`):

- If `fashionCatalogSearch.curation` **and** `fashionCatalogSearch.render` → `FashionCurationResults`
- Else if slots exist without render → fallback `FashionCatalogResults` (raw slot products)
- During stream: `narration_line` → loader rack of preview / dropped thumbs (`chat-store`)

---

## 3. Stage map (ready → screen)

| # | Stage | Code | LLM? | User-visible narration (typical) |
|---|--------|------|------|----------------------------------|
| 0 | Brief already complete | Router (prior) | Router model | — |
| 1 | Search plan | `planSearchFromBrief` | Planner Haiku | Planning / Exploring N angles |
| 2 | Per-slot catalog fan-out | `searchCatalogForSlot` | No (MCP) | Searching stores; Found N options for {garment}; live thumbs |
| 3 | Brand resolve (if stated brands) | `resolveBrandForCatalogSlots` | Brand-translate Haiku | (brand outcome later in reply) |
| 4 | Normalize | `normalizeCatalogSearchSlots` | Normalize Haiku (labels) | Filtering out the misses |
| 5 | Hard drops | `applyHardDropsForSlots` | No | + droppedImages on loader |
| 6 | Score | `scoreCatalogSlots` | No | — |
| 7 | Budget lift (outfit/capsule) | `runBudgetLiftRetries` | No | Widening the budget a little |
| 7b | Budget raise ask? | `buildBudgetRaiseAskFromContext` | No | **Stops search** → clarification UI |
| 8 | Hydration | `hydrateCatalogSlots` | No (product detail MCP) | Checking availability and fit |
| 9 | Curation Stage A | `runFashionCuration` | **Sonnet + images** (effort off, ≤2k tokens) | Curating picks / provisional rack already visible |
| 9b | Curation Stage B | `fillCurationVoice` | **Haiku text-only** (≤300 tokens) | Opening + stylist lines stream onto cards |
| 10 | Render + try-on attach | `buildRenderContractWithTryon` | No | Final cards / looks |
| 11 | Chat display | `FashionCurationResults` | — | Product UI |

---

## 4. Models

| Stage | Env / constant | Default |
|-------|----------------|---------|
| Router (before this doc) | `FASHION_ROUTER_MODEL` | Haiku (`AI_CHAT_LIGHTWEIGHT_MODEL` → `claude-haiku-4-5-20251001`) |
| Search planner | `FASHION_SEARCH_PLANNER_MODEL` | Same Haiku chain |
| Normalize | `FASHION_NORMALIZE_MODEL` | Haiku |
| Brand translate | `FASHION_BRAND_TRANSLATE_MODEL` | Haiku |
| **Curation** | `FASHION_CURATION_MODEL` | **`AI_CHAT_DEFAULT_MODEL` → `claude-opus-4-8`** |
| Curation effort | `FASHION_CURATION_EFFORT` | `"medium"` |
| Curation max tokens | `FASHION_CURATION_MAX_TOKENS` | `32000` |
| Curation timeout | `CURATION_LLM_TIMEOUT_MS` | `0` (disabled unless set) |

Verbatim prompts live in:

- Planner: `docs/fashion/planner.md` ← `src/lib/fashion-memory/search-planner/prompt.ts`
- Curation: `docs/fashion/curation.md` ← `src/lib/fashion-memory/curation/prompt.ts`
- Normalize / brand / router: `docs/fashion/*.md`

---

## 5. Input: `FashionSearchBrief` (from ready_to_search)

```ts
{
  recipient_person_id: string;
  request_type: "single_item" | "outfit" | "capsule" | "multi_item";
  garments: string[];
  occasion_context: string;
  quantity_hint: string;
  must_haves: string[];
  nice_to_haves: string[];
  budget_context: {
    max?: number;
    min?: number;
    currency?: string;
    stated: boolean;
    scope?: "per_item" | "total";
  };
  style_direction: string;
  department_scope?: FashionDepartment;
  color_direction?: { source: "stated" | "profile" | "none"; stated_colors?: string[] };
  brand_direction?: { source: "stated" | "profile" | "none"; brands?: string[] };
  stated_facts?: FashionStatedFacts;
  knowledge_state?: { department; sizes_confirmed[]; sizes_unconfirmed[] }; // filled by code gate
}
```

**Downstream profile** (`loadFashionSearchProfile`): country, currency, language, positive taste signals — used for catalog context + filters + scoring.

**Recipient facts:** size / fit / no-go facts for hard drops + hydration.

---

## 6. Stage 1 — Search planner

### 6.1 Job

Emit **exactly one** `plan_search` tool call → slots with query variants + budget fractions.

### 6.2 Plan shape (`FashionSearchPlan`)

```ts
{
  version: 1;
  mode: SearchPlanMode;
  slots: FashionSearchPlanSlot[];  // max soft-clamped (~5 planner / up to 12 after reconcile)
  reasoning: string;
  brief: FashionSearchBrief;
  currentDate: string;
  plan_source?: "planner" | "clamped" | "fallback";
  budget_allocation?: ResolvedBudgetAllocation;
}
```

**Per slot:**

| Field | Role |
|-------|------|
| `slot_id` | Stable id |
| `garment` | Category noun (shirt, trousers, …) |
| `role` | `anchor` \| `support` |
| `style_direction` | Slot-level styling |
| `palette_constraint` | Shared palette for outfit/capsule |
| `palette_source` | Provenance of palette |
| `options_wanted` | How many options UI/curator aims for |
| `query_variants` | Catalog search strings (primary + spare) |
| `budget_fraction` | Share of total budget (outfit/capsule) |
| `brand_status` / notes | Filled later if brands stated |
| `unknown_family` | No taxonomy mapping → looser retrieval |

### 6.3 Planner rules (summary — full text in `docs/fashion/planner.md`)

- `single_item`: 1 slot, options 4–5
- `outfit`: one slot per garment; exactly one `anchor`; options ~3
- `capsule`: mixable set, shared palette; options derived from rotation count
- `multi_item`: independent anchors
- Hard caps: ≤5 slots from planner, ≤8 options_wanted; explicit user counts win
- Budget fractions must sum to 1 when stated total budget + outfit/capsule

### 6.4 Post-planner code guards

`finalizeResolvedPlan`:

1. Soft clamps (`clampFashionSearchPlan`)
2. Outfit/capsule underflow → planner retry once, else expand slots
3. Reconcile missing brief garments into support slots
4. Invariants (`checkPlanInvariants`)
5. Attach `budget_allocation` (`attachBudgetAllocation` / `resolveAllocation`)

Failure → deterministic `buildFallbackPlan`.

### 6.5 SSE

`fashion_search_plan` with full plan object; also stored on message metadata as `fashionSearchPlan`.

---

## 7. Stage 2 — Catalog fan-out (images enter the system)

### 7.1 Per-slot search (`searchCatalogForSlot`)

For each plan slot (parallel via `Promise.allSettled`):

1. Build **buyer context**: `{ address_country, currency, language? }`
2. Compose **intent** string (`composeSlotIntentString`) — profile + brief + slot for MCP ranking hint
3. Split `query_variants` into **primary** (`CATALOG_PRIMARY_QUERY_COUNT`) + **spare**
4. Build **variant filter plans** (category hedge lanes A/B/C — see below)
5. Fan-out Shopify MCP `search_catalog` via `runCatalogQueryWithTimeout`
6. If thin (`< 15` unique after dedupe, or empty/failed primary) → fire spare variants, then reformulation queries
7. Dedupe hits → `FashionSlotCatalogProduct[]` with `image_urls`

**Timeouts / limits:**

- Per query: `FASHION_CATALOG_QUERY_TIMEOUT_MS` (default **25s**, max 60s)
- Target results per query path: `FASHION_CATALOG_TARGET_RESULTS` = **100**

### 7.2 Server-side filters (`buildSlotCatalogFilters`)

Always:

- `available: true`
- `ships_to: { country }` from profile

Conditional:

- **Price** when budget stated (guard band for server; enforcement client-side) — Lane B may **omit** price to scout market
- **Categories** from garment taxonomy (can omit on hedge / unknown family)
- **Target gender** on category-filtered lanes only (Male+Unisex / Female+Unisex)

**Explicit non-filters (important):**

> Color and Size are **never** sent as server `filters.attributes` — merchant free-text causes silent inventory loss. Matching is client-side after normalize.

### 7.3 How product images are obtained (pre-curation)

1. Catalog product summaries include `media` / `featured_image` / `image`
2. Mapped onto cards via `catalogSummaryToProductCard` / `extractCatalogImageUrl`
3. Slot products expose `image_urls[]`
4. Live loader: first image URL per product → SSE `narration_line.previewImages` (cap 8 unique per phase update; client keeps up to 24)

**No image composition** — listing photos only, same as onboarding grids.

### 7.4 Live progress lines from catalog

- Image-only updates per variant hit (no spam text)
- After each slot completes: `Found {n} options for {garment}`

---

## 8. Stage 3 — Brand resolution (optional)

If `brand_direction` has stated brands:

- Probe / translate unavailable brands (`resolveBrandForCatalogSlots`)
- Annotate slots with `brand_status`: `confirmed` | `partial` | `translated`
- Produce `brand_narration` string — **must** be appended to assistant reply (hard rule in stream)

---

## 9. Stages 4–6 — Normalize → hard drops → score

### 9.1 Normalize

Merchant labels → structured attributes (color, material, department, attire, etc.). May call normalize LLM (`FASHION_NORMALIZE_MODEL`).

### 9.2 Hard drops (deterministic kill rules)

`HardDropRule`:

| Rule | Meaning |
|------|---------|
| `unavailable` | Not available |
| `budget` | Over padded/enforced max (Lane B drops kept for lift) |
| `department_mismatch` | Wrong department |
| `category_mismatch` | Wrong taxonomy family |
| `item_type_mismatch` | Wrong garment type |
| `size_mismatch` | Size fails client match |
| `color_no_go` / `color_must_have` | Color constraints |
| `garment_no_go` | Garment exclusions |
| `material_no_go` / `material_must_have` | Material constraints |
| `drop_check_error` | Checker failed safe-side |

Survivors may carry **suspicions** (not hard kills): `no_price`, `size_unknown`, `color_unknown`, `attire_conflict_title`, `price_outlier_low`, etc. — passed to curator as honesty signals / exclusions.

Dropped product thumbs → `droppedImages` on narration (loader “kills”).

### 9.3 Scoring weights (`SCORING_WEIGHTS`)

| Component | Weight |
|-----------|--------|
| `shopify_rank` | 0.32 |
| `brand_match` | 0.20 |
| `corroboration` | 0.11 |
| `palette` | 0.11 |
| `size_confirmed` | 0.09 |
| `rating` | 0.09 |
| `department_confirmed` | 0.08 |
| suspicion penalty | 0.03 / flag, cap 0.08 |

Version tag: `SCORING_WEIGHTS_VERSION = "20260709-v3-brand"`.

Shortlist for hydration is score-ordered; curation sees verified pool + overflow.

---

## 10. Budget lift & budget raise ask

### 10.1 Lift (outfit/capsule + assembled budget)

If survivors too thin vs allocation:

1. Prefer **re-admit** budget-dropped / guard-band products under lifted max (zero latency)
2. Else optional **re-query** slot with `liftedMax` (skipped under tight/infeasible market)
3. Re-run normalize/hard-drop/score for that slot
4. Narrate: “Widening the budget a little”

### 10.2 Raise ask (search aborts curation)

If tension says stated budget cannot produce a viable set and user has not declined the budget gap:

- Return `budget_raise_ask` with clarification questions
- Stream **rewrites** the turn to `ask_clarification` (no curation UI)
- Skippable via `skipBudgetRaiseAsk` when gap already declined

---

## 11. Stage 8 — Hydration (availability + size)

`hydrateCatalogSlots`:

- Pull product details / variants via catalog MCP (concurrency gated)
- Wave-based fill toward `options_wanted` / bench target
- Kill causes: `size_out_of_stock`, `size_not_offered`, `gone`, `department_mismatch`, `hydration_failed`
- Size status on survivors: `confirmed` | `converted` | `unknown`
- Outputs per slot:
  - `verified_pool` — hydrated, size-checked finalists
  - `overflow_items` — scored but not fully verified bench
  - `thin_slot` / `coverage_gap` flags

Pools may be **persisted** (`persistAllSlotPools`) for later swap / promote actions.

Narration: “Checking availability and fit”.

---

## 12. Stage 9 — Visual curation (the taste LLM)

### 12.1 Inputs to curator

- Plan + mode section of system prompt
- Per-slot verified (+ overflow) candidates with refs, prices, suspicions, size provenance
- Taste signals, recipient profile block, department, budget assembly / tension
- **Product photos** as multimodal image blocks

### 12.2 How curation images are fetched

`fetchAndResizeCurationImage` (`curation-images.ts`):

1. Prefer Shopify CDN resize via `catalogDisplayImageUrl(url, 512, { crop: "center" })`
2. `fetch` image (max 2.5MB)
3. `sharp`: EXIF rotate, fit inside **512×512**, JPEG q82
4. Send to Anthropic as base64 `image/jpeg`

**Image budgets** (`CURATION_IMAGE_BUDGET`):

| Mode / role | Max images attached |
|-------------|---------------------|
| single / multi | 12 |
| outfit anchor / support | 18 / 14 |
| capsule anchor / support | 28 / 22 |

### 12.3 Tool

Exactly one `deliver_curation` tool call (`CURATION_TOOL_NAME`).

House rules (summary — full in `docs/fashion/curation.md`):

1. Enforce visual exclusions (logos, flashy, …)
2. Verify from **image**: attire, department, color (trust photo over label), fit-to-brief
3. Veto clearly wrong candidates
4. No near-identical twins
5. Honesty on converted/unknown sizes
6. State brand outcome if brand requested
7. Budget: look sums (or capsule set sum) must fit
8. One stylist sentence per pick, user’s language
9. Thin / degraded plan → honest `thin_note`

Mode sections dictate spread vs looks vs capsule set.

### 12.4 Failure / repair

- Validate tool output → repair / deterministic fallback (`buildDeterministicFallback`)
- Sanitize narration
- Build `FashionCurationPresentation` then frozen **render contract**

### 12.5 Deliverable caps

- Hero picks (single): `CURATION_HERO_PICKS = 3`
- Looks / capsule outfits target: `CURATION_LOOKS_TARGET = 3`
- Verified bench / unverified overflow caps: 10 each (presentation tiers)

Narration: “Curating picks from finalists”.

---

## 13. Stage 10–11 — Render contract → screen

### 13.1 Render contract (`types/render-contract.ts`)

**Frontend rule:** UI renders from `render` and nothing else (`RENDER_CONTRACT_VERSION = 1`).

Built by `buildPresentationContract` + `buildRenderContractWithTryon` (attaches try-on availability / avatar CTA).

Key surfaces:

| Field | Use |
|-------|-----|
| `narration.opening` / `thin_note` / `budget_note` | Chat text + banners |
| `tiers.picks` | Hero cards (`RenderPick`: stylist_line, badges, price, variant) |
| `tiers.verified` | Promotable bench |
| `tiers.unverified` | Overflow |
| `looks[]` | Outfit mode named looks (refs + totals) |
| `capsule_outfits[]` | Capsule rotations |
| `meta.mode`, `set_total`, thin/fallback flags | Layout branching |

**Badges** (honesty UI): size_converted, size_unknown, material_suspected, photo_color, near_budget_lifted, brand_unconfirmed.

### 13.2 Chat component

`FashionCurationResults`:

- Outfit → look cards composed from pick refs
- Capsule → set + rotation outfits
- Single/multi → pick grid
- Each card: image, price, stylist line, badges, FittingRoom / try-on actions

### 13.3 SSE events the client consumes

| Event | Purpose |
|-------|---------|
| `fashion_pipeline` started/complete | Phase chrome |
| `narration_line` | Progress copy + preview/dropped image rack |
| `fashion_search_plan` | Debug / metadata |
| `fashion_catalog_search` | Slots + curation + **render** → mounts results |
| `fashion_curation` | Presentation echo |
| `text_delta` | Assistant prose (opening, brand line) |
| `agent_debug` | Admin pipeline panels |

---

## 14. End-to-end data flow (compact)

```
FashionSearchBrief
  → FashionSearchPlan { slots[].query_variants, budget_allocation }
  → FashionSlotCatalogResult[] { products[], image_urls, query_logs }
  → survivors + suspicions + market_prices
  → verified_pool / overflow (hydrated)
  → deliver_curation (multimodal)
  → FashionCurationPresentation
  → render contract (+ tryon)
  → FashionCurationResults in MessageBubble
```

Persisted on assistant message metadata:

- `fashionRouter` (move + brief)
- `fashionSearchPlan`
- `fashionCatalogSearch` (slots, curation, render, brand_narration, budget_*)

---

## 15. Known constraints / improvement surfaces

1. **Latency stack:** planner + hedged catalog queries (10s hard) + batched normalize (10s hard) + hydration waves (12s hard) + Sonnet Stage A curation + Haiku Stage B voice. Provisional rack mounts after hydration (~3–6s target) before curation upgrades heroes.
2. **Sizing law:** cutoffs sit at ~2× measured p50; if p50 grows past half the cutoff, shrink the call — never raise the cutoff (`pipeline-cutoffs.ts`).
3. **Curation image budget** is top-6 single / top-4 per outfit slot @ 512px; overflow/bench are text refs only — trust the scorer.
4. **Retries:** one shrink-retry (half images) only on parse fail or hard timeout — never retry the same oversized call.
5. **Assistant prose** is Stage B Haiku (or provisional placeholder), not a second Opus turn.
6. **Listing photos ≠ styled outfits** until curator composes looks from separate garment images.
7. **Color/size not server-filtered** by design — depends on normalize + hard-drop quality.
8. **Thin slots / coverage gaps** degrade to honest copy + fallback picks; quality varies by taxonomy mapping (`unknown_family`).
9. **Budget lift vs raise-ask** tradeoff: auto-widen vs interrupt user.
10. **Dual UI path:** missing `render` falls back to raw `FashionCatalogResults` (worse UX).
11. **Brand narration** is a hard stream rule — silent substitution forbidden.
12. **Guest vs auth:** guest memory snapshot vs server facts; recipient must resolve before search.
13. **Separate from `runSearchEngine`:** improvements here don’t automatically apply to general chat search (and vice versa).

---

## 16. File map

| Path | Role |
|------|------|
| `src/lib/ai-chat/run-fashion-chat-stream.ts` | Orchestrator SSE after ready_to_search |
| `src/lib/fashion-memory/search-planner/*` | Plan from brief |
| `src/lib/fashion-memory/catalog-search/*` | Fan-out, filters, post-process, brand |
| `src/lib/fashion-memory/normalize/*` | Label normalization |
| `src/lib/fashion-memory/hard-drops/*` | Kill rules |
| `src/lib/fashion-memory/scoring/*` | Ranking weights |
| `src/lib/fashion-memory/budget/*` | Allocation, lift, tension, raise-ask |
| `src/lib/fashion-memory/hydration/*` | Size/availability verification |
| `src/lib/fashion-memory/curation/*` | Sonnet curator + Stage B voice + provisional rack |
| `src/lib/fashion-memory/pipeline-cutoffs.ts` | Tripwire / hard cutoffs + feature flags |
| `src/lib/fashion-memory/types/render-contract.ts` | Frozen UI contract |
| `src/lib/tryon/attach-render.ts` | Try-on fields on render |
| `src/components/chat/FashionCurationResults.tsx` | Display |
| `src/components/chat/MessageBubble.tsx` | Mounts curation vs catalog fallback |
| `src/components/chat/chat-store.ts` | SSE → loader images + message metadata |
| `docs/fashion/planner.md` / `curation.md` | Verbatim prompts |

---

## 17. Prompt for an improvement-review AI

> Review Shoop’s fashion-memory pipeline from `ready_to_search` through on-screen finds (document above). Propose concrete improvements prioritized by: (1) final pick quality vs brief, (2) end-to-end latency/cost, (3) honesty when inventory is thin or budget is tight, (4) outfit/capsule coherence. Prefer changes that fit Anthropic (Haiku planner / Opus curator) + Shopify catalog MCP. Call out what to keep. Include eval ideas (fixtures, kill-rate metrics, curation veto rate) and migration risk. Do not confuse this with the general `runSearchEngine` path unless proposing intentional unification.

---

## 18. Quick reference — user-facing progress copy

```
Planning your search
Exploring {N} angle(s) for “{garment|style_direction|your look}”
Searching stores
Found {n} options for {garment}          // per slot
Filtering out the misses                 // + dropped thumbs
Widening the budget a little             // optional lift
Checking availability and fit
Curating picks from finalists
(+ assistant opening / thin_note / brand_narration as text)
```
