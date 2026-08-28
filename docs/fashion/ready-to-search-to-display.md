# Fashion flow: `ready_to_search` → finds on screen

> **Superseded for agent briefing.** Cutoffs, Stage A rungs, and several counts in this file are stale (captured 2026-07-30). Share [`search-pipeline-agent.md`](./search-pipeline-agent.md) instead — it covers ready-to-search gates **and** search → display, current as of 2026-08-28.  
> Keep this file only as historical Find Pipeline v1.1 notes.
>
> **Audience:** another AI / engineer reviewing this system for improvements.  
> **Architecture:** **Find Pipeline v1.1** (shipped 2026-07-30) — pocket budgets, never-skip Stage A, provisional rack, Stage A Sonnet + Stage B Haiku voice.  
> **Scope:** fashion-memory chat pipeline **after** the router emits `ready_to_search`, through catalog retrieval, curation, and UI render.  
> **Not in scope:** router clarification / preference loading — see [`before-ready-to-search.md`](./before-ready-to-search.md) and [`router.md`](./router.md).  
> **Why v1.1:** flat 45s turn budget used to **skip** curation (`fashion_turn_budget_skip_curation`) → outfit looks missing — see [`qa-incident-curation-skip-0e1c21fa.md`](./qa-incident-curation-skip-0e1c21fa.md).  
> **Scope note:** fashion-memory is the only chat path.  
> **Source of truth:** `src/lib/ai-chat/run-fashion-chat-stream.ts`, `src/lib/fashion-memory/**`, especially `pipeline-cutoffs.ts`.  
> **Date of capture:** 2026-07-30.

---

## 1. Product intent

Once the fashion router decides the brief is complete (`ready_to_search`), Shoop:

1. Turns the brief into a **multi-slot retrieval plan** (planner Haiku — **one** live LLM call)
2. **Fans out** Shopify catalog searches per slot (10s hard / 3s hedge)
3. **Normalizes → hard-drops → scores → hydrates** (size/availability)
4. Emits a **provisional rack** so the user sees verified options while styling finishes
5. Runs **Stage A** curation (Sonnet, vision, picks) — **never skipped**, only degraded down a ladder
6. Runs **Stage B** voice (Haiku, text-only) for opening + stylist lines
7. Streams a frozen **render contract** into chat

**Budget law (v1.1):** budgets protect deliverables, not clocks. Stage A is earmarked at turn start; pre-curation overruns starve hydration/reformulation — **never** Stage A.

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
  ├─ fire-and-forget: writeRequestEventFromBrief
  ├─ guest: SSE fashion_request_event (optional)
  │
  ├─ planSearchFromBrief(...)          → FashionSearchPlan
  │     (one LLM call; underflow → deterministic expand; style-phrase slots dropped)
  │     SSE fashion_search_plan
  │     narrate "Exploring N angles…", "Searching stores"
  │
  ├─ loadFashionSearchProfile(...)
  ├─ accessTokenForCatalogMcp()
  ├─ searchFashionCatalogPlan(...)     → FashionCatalogSearchResult
  │     ├─ parallel slot MCP search (+ brand-translate prefetch)
  │     ├─ normalize → hard-drops → score
  │     ├─ budget lift retries
  │     ├─ budget_raise_ask? → abort (no hydrate/curation)
  │     ├─ hydrate verified_pool / overflow
  │     ├─ PROVISIONAL rack → SSE fashion_catalog_search { provisional: true }
  │     │     narrate "Showing verified options while I finish styling"
  │     ├─ prefetch curation images
  │     ├─ chooseStageARung(earmarkRemaining) → full | half_images | text_only | deterministic
  │     ├─ Stage A: runFashionCuration (Sonnet)
  │     └─ Stage B: fillCurationVoice (Haiku)
  │
  ├─ buildRenderContractWithTryon(...)
  ├─ SSE fashion_catalog_search (final) + fashion_pipeline { phase: "complete" }
  │
  └─ stream assistant text (opening / brand_narration / thin_note)
        + SSE fashion_curation (presentation)
```

**UI binding** (`MessageBubble.tsx`):

- If `fashionCatalogSearch.curation` **and** `fashionCatalogSearch.render` → `FashionCurationResults`
- Else if slots exist without render → fallback `FashionCatalogResults` (raw slot products)
- Mid-stream: provisional `fashion_catalog_search` upgrades in place when final arrives
- During stream: `narration_line` → loader rack of preview / dropped thumbs (`chat-store`)
- Try-on “See look on you” seeds candidate rack from render (`tryon-drawer-store.ts`)

---

## 3. Stage map (ready → screen)

| # | Stage | Code | LLM? | User-visible narration (typical) |
|---|--------|------|------|----------------------------------|
| 0 | Brief already complete | Router (prior) | Router model | — |
| 1 | Search plan | `planSearchFromBrief` | Planner Haiku (1 call) | Planning / Exploring N angles |
| 2 | Per-slot catalog fan-out | `searchCatalogForSlot` | No (MCP) | Searching stores; Found N options for {garment}; live thumbs |
| 3 | Brand resolve (if stated) | `resolveBrandForCatalogSlots` | Brand-translate Haiku | Prefetched **in parallel** with fan-out; narration later in reply |
| 4 | Normalize | `normalizeCatalogSearchSlots` | Normalize Haiku | Filtering out the misses; **Promise.race fail-open** at 10s |
| 5 | Hard drops | `applyHardDropsForSlots` | No | + droppedImages on loader |
| 6 | Score | `scoreCatalogSlots` | No | — |
| 7 | Budget lift (outfit/capsule) | `runBudgetLiftRetries` | No | Widening the budget a little |
| 7b | Budget raise ask? | `buildBudgetRaiseAskFromContext` | No | **Stops search** → clarification UI |
| 8 | Hydration | `hydrateCatalogSlots` | No (product detail MCP) | Checking availability and fit |
| 8b | Provisional rack | `provisional-rack.ts` + `onProvisional` | No | Showing verified options while I finish styling |
| 9 | Curation Stage A | `runFashionCuration` | **Sonnet + images** (effort off, ≤2k tokens) | Curating picks from finalists |
| 9b | Curation Stage B | `fillCurationVoice` | **Haiku text-only** (≤500 tokens) | Opening + stylist lines on cards; empty → retry → `voice_fallback` templates |
| 10 | Render + try-on attach | `buildRenderContractWithTryon` | No | Final cards / looks |
| 11 | Chat display | `FashionCurationResults` | — | Product UI |

---

## 4. Models & latency cutoffs

### 4.1 Models

| Stage | Env / constant | Default |
|-------|----------------|---------|
| Router (before this doc) | `FASHION_ROUTER_MODEL` | Haiku (`AI_CHAT_LIGHTWEIGHT_MODEL`) |
| Search planner | `FASHION_SEARCH_PLANNER_MODEL` | Haiku |
| Normalize | `FASHION_NORMALIZE_MODEL` | Haiku |
| Brand translate | `FASHION_BRAND_TRANSLATE_MODEL` | Haiku |
| **Curation Stage A** | `FASHION_CURATION_MODEL` | **`claude-sonnet-5`** |
| Curation effort | `FASHION_CURATION_EFFORT` | **`"off"`** |
| Curation max tokens | `FASHION_CURATION_MAX_TOKENS` | **`2000`** |
| **Curation Stage B voice** | `FASHION_CURATION_VOICE_MODEL` | Haiku |
| Voice max tokens | `FASHION_CURATION_VOICE_MAX_TOKENS` | **`300`** |
| Split Stage A/B | `FASHION_CURATION_SPLIT_ENABLED` | **on** (unless `0`/`false`) |
| Provisional rack | `FASHION_PROVISIONAL_RACK_ENABLED` | **on** |

### 4.2 Cutoffs (`pipeline-cutoffs.ts`)

Sizing law: cutoff ≈ 2× measured p50; if p50 grows past half the cutoff, shrink the call — **never raise the cutoff**.

| Constant | Default | Role |
|----------|---------|------|
| `CATALOG_QUERY_HEDGE_MS` | 3s | Fire hedge spare |
| `CATALOG_QUERY_HARD_MS` | **10s** | Best-so-far hard stop |
| `PLANNER_TRIPWIRE_MS` / `HARD` | 5s / 8s | Planner soft/hard |
| `NORMALIZE_TRIPWIRE_MS` / `HARD` | 6s / **10s** | Normalize; hard → fail-open |
| `HYDRATION_WAVE_TRIPWIRE_MS` / `HARD` | 8s / 12s | Per hydration wave |
| `CURATION_STAGE_A_TRIPWIRE_MS` | 18s | Soft degrade signal |
| `CURATION_STAGE_A_HARD_MS` | **25s** | Stage A wall (also default `CURATION_LLM_TIMEOUT_MS` when split on) |
| `CURATION_STAGE_A_SHRINK_MS` | 15s | Half-images rung threshold |
| `CURATION_STAGE_A_TEXT_ONLY_MS` | 6s | Text-only rung threshold |
| `CURATION_STAGE_B_HARD_MS` | 20s | Voice wall |
| `STAGE_A_EARMARK_MS` | **15s** | Untouchable Stage A pocket |
| `PRE_CURATION_POCKET_MS` | **30s** | Upstream work budget |

Phase 0 single-call bounds (`CURATION_HARD_MS` 55s etc.) remain for when split is off.

Verbatim prompts:

- Planner: `docs/fashion/planner.md` ← `search-planner/prompt.ts`
- Curation Stage A: `docs/fashion/curation.md` ← `curation/prompt.ts` (+ Stage A suffix in `run-curation.ts`)
- Curation Stage B: **inline** `VOICE_SYSTEM` in `curation/voice.ts` (no separate docs mirror)
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

**Garment hygiene:** style phrases that are not SKU families (e.g. `"cool style laid back"`) are sanitized via `sanitizeBriefGarments` / `isStylePhraseGarment` so they do not become junk catalog slots.

---

## 6. Stage 1 — Search planner

### 6.1 Job

Emit **exactly one** `plan_search` tool call → slots with query variants + budget fractions.

### 6.2 Plan shape (`FashionSearchPlan`)

```ts
{
  version: 1;
  mode: SearchPlanMode;
  slots: FashionSearchPlanSlot[];  // soft-clamped; code MAX_PLAN_SLOTS = 12
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
| `garment` | Category noun (shirt, trousers, …) — not style phrases |
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
- Prompt soft target: ≤5 slots, ≤8 options_wanted; explicit user counts win
- Budget fractions must sum to 1 when stated total budget + outfit/capsule

### 6.4 Post-planner code guards

`finalizeResolvedPlan` / `plan-from-brief.ts` (v1.1):

1. Soft clamps (`clampFashionSearchPlan`, `MAX_PLAN_SLOTS = 12`)
2. Outfit/capsule underflow → **deterministic expand** (no second planner LLM call)
3. Drop style-phrase slots (`isStylePhraseGarment`)
4. Reconcile missing brief garments into support slots
5. Invariants (`checkPlanInvariants`)
6. Attach `budget_allocation`

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

- Hedge: `FASHION_CATALOG_HEDGE_MS` default **3s**
- Hard: `FASHION_CATALOG_QUERY_HARD_MS` / `FASHION_CATALOG_QUERY_TIMEOUT_MS` default **10s** (max 60s)
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

- Brand-translate is **prefetched in parallel** with slot fan-out (not a clean post-fan-out stage)
- Probe / translate unavailable brands (`resolveBrandForCatalogSlots`)
- Annotate slots with `brand_status`: `confirmed` | `partial` | `translated`
- Produce `brand_narration` string — **must** be appended to assistant reply (hard rule in stream)

---

## 9. Stages 4–6 — Normalize → hard drops → score

### 9.1 Normalize

Merchant labels → structured attributes (color, material, department, attire, etc.). May call normalize LLM (`FASHION_NORMALIZE_MODEL`).

**v1.1:** wall-clock gated with `NORMALIZE_HARD_MS` (10s) via `Promise.race` — on timeout, **fail-open** (proceed without waiting forever).

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

Version tag: default `v4-taste` (`20260828-v4-taste`); set `SCORING_WEIGHTS_VERSION=v3-brand` for pre-S1 ranking.

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
- Wave-based fill toward `options_wanted` / bench target (wave hard **12s**)
- Kill causes: `size_out_of_stock`, `size_not_offered`, `gone`, `department_mismatch`, `hydration_failed`
- Size status on survivors: `confirmed` | `converted` | `unknown`
- Outputs per slot:
  - `verified_pool` — hydrated, size-checked finalists
  - `overflow_items` — scored but not fully verified bench
  - `thin_slot` / `coverage_gap` flags

Pools may be **persisted** (`persistAllSlotPools`) for later swap / promote actions.

Narration: “Checking availability and fit”.

---

## 12. Provisional rack → Stage A → Stage B

### 12.0 Provisional rack (before curation)

Default **on** (`FASHION_PROVISIONAL_RACK_ENABLED`).

After hydrate, before Stage A:

1. Build provisional presentation from verified pools
2. For outfit/capsule: **`synthesizeOutfitLooks`** so looks are never empty on the provisional path
3. SSE `fashion_catalog_search` with `provisional: true` (often thin `slots: []` — UI keys off render)
4. Narrate: **“Showing verified options while I finish styling”**

Final `fashion_catalog_search` upgrades the same message in place.

### 12.1 Stage A rung selection

`chooseStageARung(earmarkRemainingMs)`:

| Remaining earmark | Rung |
|-------------------|------|
| ≥ Stage A hard (25s) | `full` — vision + full image budget |
| ≥ shrink (15s) | `half_images` |
| ≥ text-only (6s) | `text_only` — picks without images |
| else | `deterministic` — `buildDeterministicFallback` + synthesize looks |

**Never skip Stage A.** Deterministic is still a Stage A deliverable (picks + looks), not a turn abort.

### 12.2 Inputs to Stage A curator

- Plan + mode section of system prompt
- Per-slot verified (+ overflow) candidates with refs, prices, suspicions, size provenance
- Taste signals, recipient profile block, department, budget assembly / tension
- **Product photos** as multimodal image blocks (unless text_only / deterministic)

### 12.3 How curation images are fetched

`fetchAndResizeCurationImage` (`curation-images.ts`):

1. Prefer Shopify CDN resize via `catalogDisplayImageUrl(url, 512, { crop: "center" })`
2. `fetch` image (max 2.5MB)
3. `sharp`: EXIF rotate, fit inside **512×512**, JPEG q82
4. Send to Anthropic as base64 `image/jpeg`

**Image budgets** (`CURATION_IMAGE_BUDGET`) — lean v1.1:

| Mode / role | Max images attached |
|-------------|---------------------|
| single / multi | **6** |
| outfit anchor / support | **4 / 4** |
| capsule anchor / support | **6 / 4** |

Bench + overflow remain **text refs only** beyond the image budget — trust the scorer.

### 12.4 Tools

| Phase | Tool | Role |
|-------|------|------|
| Stage A | `deliver_curation` | Picks / looks / structure (placeholder voice OK) |
| Stage B | `deliver_curation_voice` | Opening + per-pick stylist lines |

(`CURATION_PICK_TOOL_NAME` exists in config but is not the live Stage A tool name.)

House rules (summary — full in `docs/fashion/curation.md`):

1. Enforce visual exclusions (logos, flashy, …)
2. Verify from **image**: attire, department, color (trust photo over label), fit-to-brief
3. Veto clearly wrong candidates
4. No near-identical twins
5. Honesty on converted/unknown sizes
6. State brand outcome if brand requested
7. Budget: look sums (or capsule set sum) must fit
8. One stylist sentence per pick, user’s language (filled/refined in Stage B)
9. Thin / degraded plan → honest `thin_note`

### 12.5 Failure / repair ladder

1. Validate tool output → repair path
2. On parse fail / hard timeout: one **shrink-retry** (half images) — never retry the same oversized call
3. Else / deterministic rung: `buildDeterministicFallback` + **`synthesizeOutfitLooks`** (outfit/capsule must have looks)
4. Sanitize narration → `FashionCurationPresentation` → frozen **render contract**

### 12.6 Deliverable caps

- Hero picks (single): `CURATION_HERO_PICKS = 3`
- Looks / capsule outfits target: `CURATION_LOOKS_TARGET = 3`
- Verified bench / unverified overflow caps: 10 each (presentation tiers)

Narration: “Curating picks from finalists”.

### 12.7 Stage B voice

`fillCurationVoice` (`voice.ts`):

- Haiku, text-only, ≤500 tokens (was 300 — truncated mid-JSON on trace 0562bba7), hard ~20s
- Fills `narration.opening` + per-pick stylist lines; `voice_context` tint as uncached suffix
- On empty/invalid: one corrective retry, then deterministic stylist templates (`degradation.kind = voice_fallback`). Never ships Stage A placeholders ("Fitting room ready." / "See card.")
- Rate on `/api/health` as `voice.voice_fallback_rate`

See also `docs/fashion/prompt-cache-thresholds.md` for cache n/a vs broken.

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
| `fashion_request_event` | Guest sticky recipient (optional) |
| `fashion_catalog_search` | Provisional then final: slots + curation + **render** |
| `fashion_curation` | Presentation echo |
| `text_delta` | Assistant prose (opening, brand line) |
| `agent_debug` | Admin pipeline panels |

---

## 14. End-to-end data flow (compact)

```
FashionSearchBrief
  → sanitize garments (drop style phrases)
  → FashionSearchPlan { slots[].query_variants, budget_allocation }
  → FashionSlotCatalogResult[] { products[], image_urls, query_logs }
  → survivors + suspicions + market_prices
  → verified_pool / overflow (hydrated)
  → provisional render (looks synthesized if outfit/capsule)
  → Stage A deliver_curation (Sonnet multimodal | text | deterministic)
  → Stage B deliver_curation_voice (Haiku)
  → FashionCurationPresentation
  → render contract (+ tryon)
  → FashionCurationResults in MessageBubble
```

Persisted on assistant message metadata:

- `fashionRouter` (move + brief)
- `fashionSearchPlan`
- `fashionCatalogSearch` (slots, curation, render, brand_narration, budget_*, provisional flag during stream)

---

## 15. Known constraints / improvement surfaces

1. **Latency stack:** planner + hedged catalog (10s hard) + normalize (10s fail-open) + hydration waves (12s hard) + provisional mount + Sonnet Stage A + Haiku Stage B. Provisional targets ~3–6s after hydrate.
2. **Sizing law:** cutoffs at ~2× p50; shrink the call, never raise the cutoff (`pipeline-cutoffs.ts`).
3. **Pocket budgets:** Stage A earmark (15s) is untouchable; pre-curation pocket (30s) absorbs overruns — **no skip-curation path**.
4. **Curation image budget** is top-6 single / top-4 per outfit slot @ 512px; overflow/bench are text refs only.
5. **Retries:** Stage A rung shrink at start + one shrink-retry on parse/timeout — never retry the same oversized call.
6. **Assistant prose** is Stage B Haiku (or provisional placeholder), not a second heavy model turn.
7. **Listing photos ≠ styled outfits** until curator / synthesizer composes looks from separate garment images.
8. **Color/size not server-filtered** by design — depends on normalize + hard-drop quality.
9. **Thin slots / coverage gaps** degrade to honest copy + fallback picks; quality varies by taxonomy mapping (`unknown_family`).
10. **Budget lift vs raise-ask** tradeoff: auto-widen vs interrupt user.
11. **Dual UI path:** missing `render` falls back to raw `FashionCatalogResults` (worse UX).
12. **Brand narration** is a hard stream rule — silent substitution forbidden.
13. **Guest vs auth:** guest memory snapshot vs server facts; recipient must resolve before search.
14. **Single chat path:** fashion-memory owns router → planner → catalog → curation → render.

---

## 16. File map

| Path | Role |
|------|------|
| `src/lib/ai-chat/run-fashion-chat-stream.ts` | Orchestrator SSE after ready_to_search |
| `src/lib/fashion-memory/pipeline-cutoffs.ts` | Tripwire / hard cutoffs + Stage A rung + feature flags |
| `src/lib/fashion-memory/search-planner/*` | Plan from brief (1 LLM + deterministic expand) |
| `src/lib/fashion-memory/router/sanitize-garments.ts` | Drop style-phrase “garments” |
| `src/lib/fashion-memory/catalog-search/*` | Fan-out, filters, post-process, brand prefetch |
| `src/lib/fashion-memory/normalize/*` | Label normalization (race fail-open) |
| `src/lib/fashion-memory/hard-drops/*` | Kill rules |
| `src/lib/fashion-memory/scoring/*` | Ranking weights |
| `src/lib/fashion-memory/budget/*` | Allocation, lift, tension, raise-ask |
| `src/lib/fashion-memory/hydration/*` | Size/availability verification |
| `src/lib/fashion-memory/curation/run-curation.ts` | Stage A Sonnet curator |
| `src/lib/fashion-memory/curation/voice.ts` | Stage B Haiku voice |
| `src/lib/fashion-memory/curation/provisional-rack.ts` | Mid-flight rack |
| `src/lib/fashion-memory/curation/fallback.ts` | Deterministic picks + `synthesizeOutfitLooks` |
| `src/lib/fashion-memory/curation/deliverables.ts` | Image / hero / looks budgets |
| `src/lib/fashion-memory/types/render-contract.ts` | Frozen UI contract |
| `src/lib/tryon/attach-render.ts` | Try-on fields on render |
| `src/components/chat/FashionCurationResults.tsx` | Display |
| `src/components/chat/MessageBubble.tsx` | Mounts curation vs catalog fallback |
| `src/components/chat/chat-store.ts` | SSE → loader images + message metadata |
| `docs/fashion/planner.md` / `curation.md` | Verbatim Stage A / planner prompts |
| `docs/fashion/qa-incident-curation-skip-0e1c21fa.md` | Skip-curation incident → v1.1 rationale |

---

## 17. Prompt for an improvement-review AI

> Review Shoop’s fashion-memory Find Pipeline v1.1 from `ready_to_search` through on-screen finds (document above). Propose concrete improvements prioritized by: (1) final pick quality vs brief, (2) end-to-end latency/cost under pocket budgets, (3) honesty when inventory is thin or budget is tight, (4) outfit/capsule coherence (looks never empty). Prefer changes that fit Anthropic (Haiku planner / **Sonnet** Stage A curator / Haiku Stage B voice) + Shopify catalog MCP. Call out what to keep (never-skip Stage A, provisional rack, lean image budgets, style-phrase sanitize). Include eval ideas (fixtures, kill-rate metrics, curation veto rate, Stage A rung distribution) and migration risk.

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
Showing verified options while I finish styling   // provisional rack
Curating picks from finalists
(+ assistant opening / thin_note / brand_narration as text)
```
