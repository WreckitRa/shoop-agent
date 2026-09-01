# Shoop search pipeline — agent briefing

> **Audience:** an AI agent (or engineer) that must understand, critique, or patch how Shoop decides a search is ready, plans queries, filters inventory, and renders finds.  
> **Product:** Shoop — personal fashion shopper. Chat is **not** a free-text assistant. One pipeline owns every turn.  
> **Date of capture:** 2026-08-28.  
> **Source of truth:** code. If this document and code disagree, **code wins**.  
> **Entry:** `POST /api/chat` → `createFashionChatSseStream` (`src/lib/ai-chat/run-fashion-chat-stream.ts`).

Verbatim prompts (do not paraphrase when reviewing them):

| File | Live source | Stage |
|------|-------------|-------|
| [`router.md`](./router.md) | `src/lib/fashion-memory/router/prompt.ts` | Router (turn owner) |
| [`planner.md`](./planner.md) | `src/lib/fashion-memory/search-planner/prompt.ts` | Search planner |
| [`curation.md`](./curation.md) | `src/lib/fashion-memory/curation/prompt.ts` | Curation Stage A (vision) |
| [`brand_translate.md`](./brand_translate.md) | `src/lib/fashion-memory/brand/prompt.ts` | Unavailable-brand DNA |
| [`normalize_classify.md`](./normalize_classify.md) | `src/lib/fashion-memory/normalize/llm-classify.ts` | Merchant labels |

CI: `npm run check:fashion-prompts` — live prompt constants must hash-match the `## Verbatim prompt` fences.

Deeper pre-search I/O: [`before-ready-to-search.md`](./before-ready-to-search.md). Review packet with improvement-task framing: [`AGENT-REVIEW-PACKET.md`](./AGENT-REVIEW-PACKET.md). Doctrines: [`doctrines.md`](./doctrines.md).

---

## 0. How to use this document

Read in order: **§2 layer ownership → §3 sequence → §4 ready-to-search → §5 counts → §6 planner → §7–8 filters → §9 display**.

**Review contract:**

1. Attribute a bad find to **exactly one layer** (§2). Do not add a prompt ban or extra validator when the failure is upstream.
2. Code may override an LLM **only** with conversation-derived data (`stated_facts`, clarification answers). DB-only gates that ignore what she just said are doctrine violations.
3. Fallbacks must exit through the **same validators** as the happy path.
4. We do **not** own Shopify ingest. Identity is query-time taxonomy + title hard drops. Do **not** add Haiku eligibility gates or curator category bans. Do **not** junk-fill empty benches or put unverified overflow on the live rail.
5. Prefer the smallest correct change. No speculative parameters.

---

## 1. What the agent is

**Is:** a forced-tool router that either (a) redirects off-topic, (b) asks blocking + consultative clarifications with chips, or (c) emits a structured `FashionSearchBrief` and then **plans → searches Shopify catalog MCP → hard-drops → scores → hydrates → curates with vision → speaks in stylist voice**.

**Is not:** a general chat model that writes shopping prose first and tools later. The router **never** replies in free text. Catalog ranking is not “the LLM searched.” Memory extraction does **not** block this turn’s search.

**Default:** be sure what they want and at what depth, then search **once, well**. Search immediately when the brief is already complete, they signal speed, or the consultation budget is spent.

---

## 2. Layer ownership (patch discipline)

A bad find is attributable to **exactly one** layer.

| Layer | Job | Owner | Failure mode | Illegal “fixes” |
|-------|-----|-------|--------------|-----------------|
| **L2 Interpretation** | Utterance → brief (hard vs soft) | `router/*`, `intake/post-router.ts` | Misread her | Prompt bans for catalog leakage |
| **L3 Eligibility** | Boolean hard predicates only | `hard-drops/*` + `catalog-search/garment-taxonomy.ts` | Wrong item in bench | Haiku “is this a shirt?” gates |
| **L4 Availability** | Sized + purchasable | Hydration `verified_pool` | Showing unbuyable | Putting overflow on the live rail |
| **L5 Judgment** | Rank among eligible | `scoring/*`, curator Stage A | Bad taste on a clean bench | Eligibility rules in curator prompt |
| **L6 Composition** | Count, headers, empty/short prose | `curation/presentation.ts`, `composition-invariants.ts` | Overclaiming / junk-fill | Fake extra picks to fill the rack |
| **L0 Observability** | Boundary sizes + rejection reasons | `recordPipelineEvent`; hard_drops `rejection_samples` | Untargetable bugs | Logging without samples |

---

## 3. End-to-end sequence

```
POST /api/chat
  persist user message (dedupe consecutive dupes)
  assembleRouterContext            # roster + profiles + last 12 turns     [code]
  identity gate                    # recipient/person BEFORE router LLM    [code]
  ROUTER LLM                       # exactly one tool
      respond_off_topic         → stream reply, STOP
      ask_clarification         → sanitize / dedup / dodge → chips UI, STOP
                                  (if all gaps satisfied → upgrade to search)
      ready_to_search           → FashionSearchBrief
  apply stated_facts               # people + fashion_facts                 [code]
  identity gate dept/size          # may inject gate_retry LLM or templates
  dodge: gap asked twice + declined → proceed unconfirmed
  finalizeBriefForSearch
  ──────── SEARCH STARTS HERE ────────
  PLANNER LLM                      # plan_search → slots + query_variants
      fail → deterministic fallback plan (no second planner call)
  CATALOG MCP fan-out              # no scoring here
  brand translate LLM              # only if named brand is scarce
  normalize labels LLM             # cache/deterministic miss only
  HARD DROPS                       # department/category/item-type/size     [code]
  SCORING                          # rank survivors                         [code]
  budget lift / budget-raise ask   # may abort to clarification
  HYDRATION                        # size + purchasable → verified_pool
  provisional rack SSE             # verified options while styling finishes
  CURATION STAGE A                 # Sonnet + images, always full vision
      fail/timeout → deterministic fallback + honest thin_note
  CURATION STAGE B                 # Haiku voice (opening + stylist_lines)
  buildRenderContract (+ try-on attach in parallel)
  SSE fashion_catalog_search (final) + assistant text
  EXTRACTION LLM (detached)        # does not block SSE; guests skip
```

Typical user-facing progress copy:

```
Planning your search
Searching stores for “{garment}”  /  Searching stores across N angles for “…”
Found {n} options for {garment}
Filtering out the misses
Checking stock and your size
Hanging verified pieces while I finish styling
Choosing what I’d actually put on you
(+ assistant opening / thin_note / brand_narration as text)
```

---

## 4. How the agent knows it is ready to search

Search starts **only** when the router move is `ready_to_search` **and** post-router code has not bounced it back to clarification.

### 4.1 Three router moves

The router LLM (`FASHION_ROUTER_MODEL`, default Sonnet) calls **exactly one** tool per turn:

| Tool | When | What happens |
|------|------|----------------|
| `respond_off_topic` | Nothing shoppable, and no styling raw material | Stream a warm redirect. Stop. |
| `ask_clarification` | Blocking gap remains, **or** consultative questions would change the pull and budget remains | Chips UI. Stop (unless code upgrades — §4.6). |
| `ready_to_search` | Pre-flight checklist passes, **or** consultation budget is spent | Emit `FashionSearchBrief`. Pipeline continues. |

A greeting / “I need something” is **never** off-topic — it is first-contact clarification (`gap:"garment"`). Life context (trips, weddings, new jobs, weather) is styling raw material, not off-topic.

### 4.2 Minimum viable brief (LLM pre-flight)

From `ROUTER_PROMPT_STATIC` — **all** boxes must be checked, or it is MOVE 2:

1. **WHAT** — garment type(s), or an inferable shopping direction.
2. **WHO** — roster person, or **self by default** when nothing implies a gift. Unique roster relation (`my mother` + one mother) resolves silently.
3. **Department + sizes** — PROFILES or this conversation give department and size for every garment family this brief will search, **or** the user declined that gap twice (documented degradation).
4. **Occasion / use** — rough context. May be inferred from life-mode when the ask is not event-shaped.

Nice-to-haves (color, vibe, brand, budget) **never alone** justify a blocking clarification. They may be **consultative** questions when they would change the pull.

**Stated facts are knowledge immediately.** Anything said this conversation (sizes, department, who, budget) counts the moment it is said. The router must copy it into `stated_facts`. Asking again is a hard failure. Profile sizes stay in PROFILES for skip-ask — they are **not** copied into `stated_facts` just because they are on file.

### 4.3 Blocking vs consultative questions

| Kind | Test | Gaps |
|------|------|------|
| **Blocking** | Search would be **wrong** without the answer | `garment`, `recipient`, `person_name`, `department`, `size`, `occasion` |
| **Consultative** | Search would be **different** depending on the answer | `depth`, `slots`, `preference_anchor`, `budget`, `style_lane`, `color`, `brand`, `fit`, `formality`, `direction` |

Consultative questions are allowed only when **all three** hold: (a) the answer would change what a stylist pulls, (b) neither conversation nor PROFILES answers it, (c) consultation budget is not spent.

**`preference_anchor` is mandatory, not on the menu.** If PROFILES has any relevant signal / size-fit / brand / past pick for these garments, the pull sheet **must** ask “the usual / push me / something new.” The router may not reach `ready_to_search` with an undeclared anchor on a known client. Skip only when they already said it, this is a refinement of on-screen results, or nothing in PROFILES relates to these garments (`unspecified`).

**`slots`** (outfit/capsule only): checklist of the head-to-toe decomposition, preselected for what a stylist would pull. Their answer becomes `brief.garments` **exactly** — add nothing back. Dressy/formal occasions must include a jacket layer preselected. Skip when they already named every garment. **Never** a slots checklist for `multi_item` — ask `gap:"garment"` instead.

Bundle currently-blocking gaps **and** chosen consult questions into **one** turn, max **4** questions, each with 2–5 chips. UI always adds Other (except `person_name` → Skip only). Every consultative question (except `preference_anchor`) carries a “You decide” chip; every consult turn carries a “Just show me” escape.

### 4.4 Consultation budget (hard cap in code)

| Rule | Value |
|------|-------|
| Default | **One** consultative turn per request |
| Second turn | Only if the first answer opened a real fork |
| Hard cap | **2** consultative rounds (`consult_rounds_used`), then search |
| Blocking rounds | Do **not** count |
| Speed signals | “just go”, “yalla”, “vas-y” — LLM intent, not regex → search and list `brief.assumptions` |

When `consult_rounds_used >= 2`, the uncached router context appends:

```
CONSULTATION BUDGET SPENT — call ready_to_search and list assumptions.
```

Unasked consultative calls go in `brief.assumptions[]` (client language, ≤14 words, no pipeline words) and must be voiced on results.

Repeat clients get asked less: `shopping_style:quick` skips consultative questions except `preference_anchor` (pre-selected to “The usual”). `depth_default` in PROFILES is treated as `depth.source:"stated"` — never ask depth.

### 4.5 Identity is code, not the LLM

`intake/identity-gate.ts` + `people.ts`:

- Recipient (existing roster vs `"new"`) is resolved **in code before** the router LLM registers facts.
- Never trust the LLM to invent a `recipient_person_id`.
- Account sizing/department apply **only** to `relation === "self"`. Gift recipients never inherit the shopper’s size.
- After `ready_to_search`, code **re-checks** department + sizes. If still missing: `gate_retry` (second router call with a system note) or deterministic templates (`buildBlockingClarification`).
- Size questions cover **every family the brief will search** (from `brief.garments`, plus dresses on womens outfit/capsule). Accessories are mostly one-size — do not ask top/shoe sizes unless a sized family is in play (belt → bottoms).

### 4.6 Code can upgrade or reject the LLM’s move

`intake/post-router.ts` after the tool call:

| Situation | Result |
|-----------|--------|
| Clarification questions all satisfied by stated_facts / chip answers | Upgrade to `ready_to_search` |
| Empty clarification (no remaining questions) | Upgrade to `ready_to_search` |
| Same **blocking** gap asked twice and declined (`gapsToDeclineAfterDodge`, `asks >= 2`) | Stop asking it. Proceed with `knowledge_state` marked unconfirmed |
| `ready_to_search` but department/size still blocking | Bounce to clarification (`gate_retry` or templates) |
| `ready_to_search` with unspecified preference_anchor on overlapping known clients | Reject — must ask |
| Parse failure | `FALLBACK_CLARIFICATION`: “What are you looking for — a single piece, or a full look?” |

Parked brief: `ask_clarification` **must** include `brief` whenever WHAT is known, so a size-chip turn does not invent a new request. Omit brief **only** when `gap` is `"garment"` because we genuinely do not know what they want.

### 4.7 Brief fields (`FashionSearchBrief`)

```
recipient_person_id
request_type          single_item | outfit | capsule | multi_item
garments[]            garment types actually implied (user’s noun, never coerced)
occasion_context
quantity_hint         user’s own quantity language
must_haves[]          hard requirements stated THIS request (incl. “black” in “a black shirt”)
nice_to_haves[]
budget_context        { stated, max?, min?, currency?, scope?: per_item|total }
style_direction       one sentence a stylist can work from
department_scope?
color_direction       { source: stated|profile|none, stated_colors? }
brand_direction       { source: stated|profile|none, brands? }
stated_facts?         conversation-stated who / dept / sizes / budget
knowledge_state?      filled by CODE gate — never by the LLM
depth?                { looks_wanted?, options_per_item?, source: stated|you_decide|assumed }
preference_anchor?    keep | push | explore | unspecified
consultation?         { confirmed[], rounds_used: 0|1|2 }
assumptions[]         unasked calls, voiced on results
voice_context?        filled by CODE from shopper onboarding
```

**`request_type` is owned by the router LLM.** Code does **not** keyword-coerce it or invent garments/occasion. Accessories and swim nouns pass through verbatim — never coerce into shirts.

| `request_type` | Meaning | Garments in the brief |
|----------------|---------|------------------------|
| `single_item` | One named garment | That garment only (`["shirt"]`) |
| `outfit` | Head-to-toe for one occasion | Stylist decomposition for that occasion (e.g. top + bottoms + shoes). **Never** collapse “beach outfit” into `["top"]`. |
| `capsule` | Rotation / wardrobe set | Mixable set to compose `looks_wanted` outfits |
| `multi_item` | Several **unrelated** garments | Named pieces only. Do **not** invent a head-to-toe. If unnamed, ask `gap:"garment"` and wait. |

`sanitizeBriefGarments` / `isStylePhraseGarment` drop style phrases that are not SKU families (`"cool style laid back"`) so they never become catalog slots.

---

## 5. Counts — garments, slots, options, picks, looks

These numbers are the appointment. Do not invent a larger rack.

### 5.1 Depth (`agreed-depth.ts`)

`DEPTH_CEILING = 8`. Defaults when the brief carries no number: **3 picks** (single/multi), **3 looks** (outfit/capsule).

| Brief field | Applies to | Becomes |
|-------------|------------|---------|
| `depth.options_per_item` | `single_item` / `multi_item` | picks per slot |
| `depth.looks_wanted` | `outfit` / `capsule` | looks to compose; also the **anchor** slot’s `options_wanted` |
| `depth.source` | all | `stated` (they named a number) / `you_decide` (chip) / `assumed` (router guessed — must appear in `assumptions`) |

Outfit/capsule **support** slot `options_wanted` = `ceil(looks × 0.75)`, min 2 (`slotDepthForLooks`).

### 5.2 Planner slots (`MAX_PLAN_SLOTS = 12`)

| Mode | Slot count | Roles |
|------|------------|-------|
| `single_item` | **Exactly 1** (code clamps extras away) | that slot is `anchor` |
| `outfit` | One slot per garment a stylist would pull; code expands if planner under-covers brief garments | **exactly one** `anchor`; rest `support` |
| `capsule` | Mixable set (tops + bottoms + shoes + layers), **shared palette** | one `anchor` (usually tops) |
| `multi_item` | One slot per requested garment | all `anchor` — no coherence coupling |

Skip useless underlayers unless asked (underwear, socks, undershirts, hosiery). Never invent slots for garments the user excluded or already owns (`"I have shoes"` → no shoe slot). Duplicate families are collapsed (`uniqueSlotsByFamily`).

Accessory requests decompose like a stylist tray (belt, watch, wallet, tie, bag…) with `multi_item` semantics.

### 5.3 Query variants

Planner emits **4–5** query strings per slot, best → worst. Catalog runs the **top 3** first (`CATALOG_PRIMARY_QUERY_COUNT = 3`); variants 4–5 are spare fallback if results are thin.

### 5.4 Catalog recall

| Knob | Value |
|------|-------|
| Target hits per query path | `FASHION_CATALOG_TARGET_RESULTS = 100` |
| Thin-slot threshold (fire spares / reformulation) | `< 15` unique after dedupe, or empty/failed primary |
| Loader preview thumbs | 8 unique URLs per phase (client keeps up to 24) |

### 5.5 Hydration bench

Target verified count per slot = `ceil(options_wanted × 3.5)` (`HYDRATION_BENCH_MULTIPLIER`). Initial wave capped at 20 `get_product` calls; global concurrency default 6.

### 5.6 What curation / UI may show

| Surface | Cap |
|---------|-----|
| Hero picks / looks | `agreedDepth` (default 3, ceiling 8) — **not** a fill target |
| Verified bench under heroes | 10 per garment |
| Unverified overflow | **empty on the live rail** (capped 10 in pools for debug / on-demand verify only) |
| Curator images attached | single/multi **6**; outfit **4 per slot**; capsule **6 / 4** (anchor / support) |

Short/empty benches get an honest `thin_note`. Never junk-fill.

```
eligibleCount ≤ 0 → “Nothing solid for {label} came through from stores I can reach…”
eligibleCount ≤ 2 → “Only N true {label} came back. Showing what matches — not padding the rail.”
```

---

## 6. How it plans the queries

### 6.1 Job

`planSearchFromBrief` → one planner Haiku call (`FASHION_SEARCH_PLANNER_MODEL`) → `plan_search` tool exactly once → `FashionSearchPlan`.

User message: `CURRENT DATE` + `BRIEF (JSON)` + recipient-only `RECIPIENT PROFILE`.

Failure or hang (`PLANNER_HARD_MS` default **15s**) → `buildFallbackPlan`. **No second planner LLM call.** Outfit/capsule slot underflow → **deterministic expand** (`expandOutfitSlots` / `buildSlotsFromGarments`).

### 6.2 Per-slot plan fields

| Field | Role |
|-------|------|
| `slot_id` | Stable id |
| `garment` | Category noun (shirt, trousers, …) — not a style phrase |
| `role` | `anchor` \| `support` |
| `style_direction` | One line a buyer can act on for **this** slot |
| `palette_constraint` / `palette_source` | Shared palette for outfit/capsule (ladder below) |
| `options_wanted` | How many options this slot aims to surface (1–8) |
| `query_variants` | 4–5 catalog search strings |
| `budget_fraction` | Share of total budget (outfit/capsule + stated budget only; must sum to 1) |
| `unknown_family` | No taxonomy mapping → looser retrieval (code-annotated) |

### 6.3 Query string rules (planner prompt + `query-rules.ts`)

Shape: when department is mens/womens/boys/girls/baby, **department word is the first token of every variant**, then `<product type> + 2–3 style descriptors`.

Each variant uses a **different vocabulary register** (classic retail, editorial, material-led, brand-led, broader catch).

**Banned** from every query string (enforced in code by `repairSlotQueryVariants`):

- sizes and size words
- recipient words (`brother`, `wife`, `gift` — **not** mens/womens retail words)
- occasion-as-purpose (`for work`, `wedding guest`)
- quantity, price, budget words
- `outfit`, `look`, `capsule`, `full`, `complete`, `head-to-toe`

Colors: at most **one** variant may carry a color word. `must_haves` that are product attributes (`linen`, `long sleeve`) belong in queries. Occasion and recipient never do.

Stated brand → variant 1 **must** be the brand probe: `"<brand> <department> <garment>"`. Remaining variants omit brand (`ensureBrandProbeVariant`).

### 6.4 Palette ladder (preference_anchor modifies it)

1. **STATED** color this request → `palette_source:"stated"`
2. **PROFILE** color signals → `"profile"` (`keep` makes this binding; `explore` **skips** this rung)
3. **OCCASION DEFAULT** → `"occasion_default"`
4. **SPREAD** → `palette_constraint:null`, `"spread"`

`push` resolves as normal then widens: one variant per slot may step to an adjacent palette family. Outfit/capsule: rungs 1–3 on the anchor; support derives from the anchor.

### 6.5 Post-planner code (`finalizeResolvedPlan`)

Every plan — LLM, clamped, or fallback — exits here:

1. Soft clamps (`clampFashionSearchPlan`): max 12 slots, unique families, `options_wanted` bound to `agreedDepth`, single_item forced to 1 slot, exactly one outfit/capsule anchor, 4–5 repaired query variants, brand-probe variant 1.
2. Outfit/capsule underflow → deterministic expand (not a second LLM).
3. Drop style-phrase slots.
4. Reconcile missing brief / `style_direction` garment nouns into support slots.
5. `checkPlanInvariants`.
6. Attach `budget_allocation` (`padded_max`, `guardMaxMajor`).

FX: `prefetchFxRates` before hard drops filter on price.

SSE: `fashion_search_plan` with the full plan object.

---

## 7. How the search runs (catalog fan-out)

`searchFashionCatalogPlan` → per-slot `searchCatalogForSlot` in parallel (`Promise.allSettled`). **No scoring at this stage.**

### 7.1 Per slot

1. Buyer context: `{ address_country, currency, language? }`.
2. `composeSlotIntentString` — ranking **hint** for MCP, not a filter.
3. Split `query_variants` into primary (top 3) + spare (4–5).
4. Build **variant filter plans** (lanes A/B/C — §8.1).
5. Fan-out Shopify / UCP `search_catalog` via `runCatalogQueryWithTimeout`.
6. If thin (`< 15` unique, or empty/failed primary) → fire spare variants, then reformulation queries (`buildReformulationQueryVariants`).
7. Dedupe → `FashionSlotCatalogProduct[]` with `image_urls`.

Timeouts (`pipeline-cutoffs.ts`): hedge **3s** (`CATALOG_QUERY_HEDGE_MS`); hard **20s** (`CATALOG_QUERY_HARD_MS`) takes best-so-far.

Brand-translate is **prefetched in parallel** with fan-out when `brand_direction` has stated brands. Thin brand pool → Haiku produces **style descriptors, not competitor names**. Silent substitution is forbidden — `brand_narration` **must** appear in the assistant reply (`confirmed` | `partial` | `translated`).

---

## 8. All filtration steps (in order)

Filtration is a funnel. A drop at L3 means the product **cannot be shown at all**, even as curator tier-2.

```
MCP hits
  → server filters (sent with the query)
  → dedupe
  → normalize (labels → canonical buckets)
  → hard drops (L3 kill rules)
  → score (L5 rank among survivors)
  → budget lift (optional re-admit / re-query)
  → budget-raise ask? (abort — no hydrate/curation)
  → hydrate (L4 size + stock)
  → presentation (L6: verified only on the live rail)
  → Stage A vision veto (L5 judgment, not eligibility)
```

### 8.1 Server-side catalog filters (`buildSlotCatalogFilters`)

**Always:**

- `available: true`
- `ships_to: { country }` from profile

**Conditional:**

- **Price** when budget is stated — server sends `guard_max` (padded × relevance multiplier). Enforcement stays client-side at `padded_max`. Lane B **omits** price to scout the market.
- **Categories** from garment taxonomy (`taxonomyCategoriesForGarment`). Omitted on Lane A (category hedge) and when the family has no mapping (`unknown_family`).
- **Target gender** on gendered departments: Male+Unisex / Female+Unisex. Kids/baby have no server gender filter. **Never omit gender on Lane A** — that is how mens/womens inventory mixes.

**Never sent as server `filters.attributes`:** Color, Size. Merchant free-text (`"noir"`, `"m-38"`) silently empties inventory. Matching is **client-side** after normalize.

**Lanes** (`category-hedge.ts`) when a taxonomy mapping exists:

| Lane | Category | Price | When |
|------|----------|-------|------|
| A | omitted | on (if budget stated) | always — hedge |
| B | on | **omitted** | budget stated — market scout |
| C | on | on | precise |

No budget stated → collapse to A + C (two queries). No taxonomy mapping → every lane stays open (no category filter).

### 8.2 Normalize

Merchant color/size/department/attire labels → structured attributes. Cache + deterministic + fuzzy first; Haiku (`FASHION_NORMALIZE_MODEL`) on miss. Hang-safety `NORMALIZE_HARD_MS` default **15s**, fail-open (proceed without waiting forever).

### 8.3 Hard drops (L3, final)

`applyHardDropsForSlots` → `applyHardDrops`. Order of checks (availability/budget first, then size, then identity/constraints):

| Rule | Meaning |
|------|---------|
| `unavailable` | `availableForSale=false` or all variants unavailable |
| `budget` | Over padded/enforced max or under min (Lane B drops kept for lift) |
| `department_mismatch` | Wrong gendered department (unknown **survives**, flagged) |
| `category_mismatch` | Taxonomy GID outside the slot’s expected family |
| `item_type_mismatch` | Title/type is a different garment family (incl. swim subtype) |
| `size_mismatch` | Resolved sizes exist and **none** correspond to the recipient |
| `color_no_go` / `color_must_have` | Profile no-go or stated must-have color |
| `garment_no_go` | Profile garment exclusion |
| `material_no_go` / `material_must_have` | Material constraints |
| `drop_check_error` | Checker failed safe-side |

Unknown size / unknown department / missing price → **suspicion, not a drop**. Size hard-drop only runs when we have a recipient size for that family and the product has resolved size labels.

**Suspicions** (not kills) travel to the curator: `no_price`, `size_unknown`, `size_system_unverified`, `color_unknown`, `color_two_tone`, `pattern_suspected`, `department_unknown`, `attire_conflict_title`, `price_outlier_low`, `currency_unconverted`, `material_suspected:*`.

Events **must** include `rejection_samples` (product_id + rule + evidence), not counts only. Tripwires: `EXCESSIVE_DROP_RATIO = 0.7`, `JUNK_FILL_RATIO = 0.5`.

Dropped thumbs → `droppedImages` on narration (loader “kills”).

### 8.4 Scoring (L5 rank, not eligibility)

`scoreProduct` → `final`; `stableSortProducts` (ties broken by original index). Default `SCORING_WEIGHTS_VERSION=v4-taste` (`20260828-v4-taste`); `v3-brand` is the pre-S1 table.

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

Also: attire-conflict penalties, price-outlier suspicion. Shortlist for hydration is score-ordered.

Cross-slot dedupe (`dedupeProductsAcrossSlots`) after scoring so the same UPID is not a hero in two slots.

### 8.5 Budget lift vs raise-ask

`budgetAllocation.ts` from `budget_context`. Outfit/capsule with a stated **total** budget get per-slot `budget_fraction` summing to 1.

If survivors are too thin vs allocation:

1. Prefer **re-admit** budget-dropped / guard-band products under lifted max (zero latency).
2. Else optional **re-query** the slot with `liftedMax` (skipped under tight/infeasible market).
3. Re-run normalize → hard-drop → score for that slot.
4. Narrate widening.

If a **required slot has zero verified items** after lift+hydrate and the
gap is budget (infeasible tension or min-viable above the ceiling): return
`budget_raise_ask`. The stream **rewrites** the turn to `ask_clarification`
— **no curation, no find UI**. A non-empty verified set always proceeds
(`budget_note` + **Loosen the budget** chip), even when tension is tight.
Declined twice → stop blocking (`skipBudgetRaiseAsk`).

### 8.6 Hydration (L4)

`hydrateCatalogSlots` — product-detail MCP (`get_product`), wave fill toward `options_wanted × 3.5`. Wave hang-safety `HYDRATION_WAVE_HARD_MS` default **60s**. Unverified items must **not** pad the live rail.

Kill causes: `size_out_of_stock`, `size_not_offered`, `gone`, `department_mismatch`, `hydration_failed`.

Size status on survivors: `confirmed` | `converted` | `unknown`. Honesty badges ship on converted/unknown.

Outputs per slot:

- `verified_pool` — hydrated, size-checked finalists. **These are finds.**
- `overflow_items` — scored but not fully verified. Debug / on-demand verify only.
- `thin_slot` / `coverage_gap` flags when the verified pool is too small for the family.

Pools may be persisted (`persistAllSlotPools`) for later swap / promote.

### 8.7 What is **not** a filter

- Color/size as Shopify server attributes (by design).
- Curator prompt category bans (illegal L3 fix).
- Clock pressure stripping Stage A images (`chooseStageARung` always returns `"full"`).
- Unverified overflow on the live rail (`presentation.ts` sets `tiers.unverified = []`).

---

## 9. Curation → render contract → screen

### 9.1 Provisional rack (before Stage A)

Default on (`FASHION_PROVISIONAL_RACK_ENABLED`). After hydrate:

1. Build presentation from **verified** pools.
2. Outfit/capsule: `synthesizeOutfitLooks` so looks are never empty on this path.
3. SSE `fashion_catalog_search` with `provisional: true` (often thin `slots: []` — UI keys off `render`).
4. Narrate hanging verified pieces.

Final `fashion_catalog_search` upgrades the same message in place.

### 9.2 Stage A — vision judgment (never skipped)

Sonnet (`FASHION_CURATION_MODEL`, default `claude-sonnet-5`) + product photos. Tool: `deliver_curation`. Hang-safety `CURATION_SAFETY_MS` / `CURATION_STAGE_A_HARD_MS` default **180s** — outer abort only, **not** a quality budget.

`chooseStageARung` always returns `"full"`. Time pressure must not strip images or force deterministic fallback — that path ships unmarked inventory (historical skip-curation incident: [`qa-incident-curation-skip-0e1c21fa.md`](./qa-incident-curation-skip-0e1c21fa.md)).

Inputs: plan + full brief + per-slot verified (+ overflow as **text refs** beyond the image budget) + taste signals + recipient profile + budget assembly/tension + photos (512×512 JPEG).

House rules (full text in [`curation.md`](./curation.md)): enforce visual exclusions; verify attire / department / color (**trust photo over label**) / fit-to-brief; veto clearly wrong; no near-twins; honesty on converted/unknown sizes; state brand outcome; look/set sums must fit budget; thin/degraded → honest `thin_note`.

On LLM failure or outer abort: `buildDeterministicFallback` + `validateAndRepairFallback` — honest rack from verified pools, **no hallucinated picks**. Outfit/capsule looks synthesized if missing. Fallbacks exit the same validators as the happy path.

### 9.3 Stage B — voice

Haiku (`FASHION_CURATION_VOICE_MODEL`), text-only, `deliver_curation_voice`. Fills `narration.opening` + one `stylist_line` per pick. Hang-safety **60s**. Empty/invalid → one retry → deterministic templates (`voice_fallback`). Never ship Stage A placeholders (“Fitting room ready.” / “See card.”).

### 9.4 Presentation contract (L6)

`buildPresentationContract`:

- Heroes = curator picks that resolve in the **verified** registry.
- Look-only refs (e.g. a tie in a look that wasn’t a hero) are promoted so chat/try-on show real product metadata.
- Verified bench = remaining verified, score-ranked, cap 10, excluding vetoed/picked.
- **`tiers.unverified` is always `[]`** on the live rack.
- Headers come from survivor contents (`displayGarmentFromSurvivors`) — never claim a construction the titles contradict (swim two-piece vs one-piece).
- Duplicate UPIDs / header mismatches emit `invariant_warning`.

### 9.5 Render contract (what the client is allowed to see)

`RENDER_CONTRACT_VERSION = 1`. UI renders `render` and **nothing else**.

Built by `buildRenderContract` immediately (so the rack ships), then `buildRenderContractWithTryon` upgrades in parallel with reply text.

Client metadata: `fashionCatalogSearch` / `fashionRouter` — **never** raw pre-drop pools. `ruled_out` / `dropped` on slots = debug reasons, never product ids outside the survivor pool.

| Field | Use |
|-------|-----|
| `narration.opening` / `thin_note` / `budget_note` | Chat text + banners |
| `tiers.picks` | Hero cards (`stylist_line`, badges, price, variant) |
| `tiers.verified` | Promotable bench |
| `tiers.unverified` | Always empty on live rail |
| `looks[]` | Outfit named looks (refs + totals) |
| `capsule_outfits[]` | Capsule rotations |
| `meta.mode`, `set_total`, thin/fallback flags | Layout branching |

**Honesty badges:** `size_converted`, `size_unknown`, `material_suspected`, `photo_color`, `near_budget_lifted`, `brand_unconfirmed`.

### 9.6 Chat display (`FashionCurationResults`)

`MessageBubble.tsx`:

- If `fashionCatalogSearch.curation` **and** `fashionCatalogSearch.render` → `FashionCurationResults`
- Else if slots exist without render → fallback `FashionCatalogResults` (raw slot products — worse UX)
- Mid-stream: provisional upgrades in place when final arrives

Layout:

| Mode | On screen |
|------|-----------|
| `outfit` (and `multi_item` with composed looks) | Named look cards from pick refs |
| `capsule` with `capsule_outfits` | Mixable set + enumerated rotations |
| `single_item` / else | Hero pick grid |

Each card: image, price, stylist line, badges, Fitting Room / try-on. Opening / `thin_note` / `brand_narration` stream as assistant text. Assumptions from the brief are voiced on results (`formatPullSheetRecap`).

If `render.tiers.picks` is empty, the component returns `null` — no junk-fill.

---

## 10. Compact data flow

```
user message
  → FashionRouterResult
  → FashionSearchBrief                    (ready_to_search + code gates)
  → sanitize garments (drop style phrases)
  → FashionSearchPlan { slots[].query_variants, budget_allocation }
  → FashionSlotCatalogResult[] { products[], image_urls }
  → survivors + suspicions + market_prices
  → verified_pool / overflow (hydrated)
  → provisional render (looks synthesized if outfit/capsule)
  → Stage A deliver_curation (Sonnet multimodal | deterministic fallback)
  → Stage B deliver_curation_voice (Haiku)
  → FashionCurationPresentation           (verified only)
  → render contract (+ try-on)
  → FashionCurationResults
```

Persisted on the assistant message:

- `fashionRouter` (move + brief + declined_gaps)
- `fashionSearchPlan`
- `fashionCatalogSearch` (slots, curation, render, brand_narration, budget_*, provisional flag during stream)

---

## 11. Models and hang-safety (defaults; env overrides win)

| Stage | Default model | Hang-safety |
|-------|---------------|-------------|
| Router | Sonnet `claude-sonnet-5` (`FASHION_ROUTER_MODEL`) | — |
| Router escalation | Opus (`FASHION_ROUTER_ESCALATION_MODEL`) when invariants trip | — |
| Planner | Haiku | 15s → deterministic plan |
| Normalize | Haiku | 15s fail-open |
| Brand translate | Haiku | (parallel with fan-out) |
| Catalog query | MCP (no LLM) | hedge 3s / hard 20s |
| Hydration wave | MCP | 60s |
| Curation Stage A | Sonnet `claude-sonnet-5` | **180s** outer abort; always full vision |
| Curation Stage B | Haiku | 60s → voice templates |

Opus 4.7+ / Sonnet 5: **omit custom `temperature`** (API 400).

`STAGE_A_EARMARK_MS` (15s) and `PRE_CURATION_POCKET_MS` (30s) are **observability pockets only** — they no longer starve or degrade Stage A.

---

## 12. File map

| Path | Role |
|------|------|
| `src/app/api/chat/route.ts` | HTTP → SSE |
| `src/lib/ai-chat/run-fashion-chat-stream.ts` | Orchestrator |
| `src/lib/fashion-memory/router/*` | L2 brief |
| `src/lib/fashion-memory/intake/identity-gate.ts` | Recipient + dept/size gate |
| `src/lib/fashion-memory/intake/post-router.ts` | Dedup, dodge, upgrade/reject |
| `src/lib/fashion-memory/agreed-depth.ts` | Picks / looks appointment |
| `src/lib/fashion-memory/search-planner/*` | Slots + query variants |
| `src/lib/fashion-memory/catalog-search/*` | MCP fan-out, lanes, filters |
| `src/lib/fashion-memory/normalize/*` | Label normalization |
| `src/lib/fashion-memory/hard-drops/*` | L3 kill rules |
| `src/lib/fashion-memory/scoring/*` | L5 rank |
| `src/lib/fashion-memory/budget/*` | Caps, lift, raise-ask |
| `src/lib/fashion-memory/hydration/*` | L4 size + stock |
| `src/lib/fashion-memory/curation/*` | Stage A/B, presentation, render |
| `src/lib/fashion-memory/pipeline-cutoffs.ts` | Hang-safety + `chooseStageARung` |
| `src/lib/tryon/attach-render.ts` | Try-on fields on render |
| `src/components/chat/FashionCurationResults.tsx` | Display |
| `src/components/chat/MessageBubble.tsx` | Curation vs raw-catalog fallback |
| `src/lib/fashion-memory/fixtures/*.test.ts` | Production-trace regressions |

---

## 13. Explicit non-goals (do not “fix” these)

- A second chat model that “just talks.”
- Keyword-coercing `request_type` or inventing garments/occasion in code.
- Haiku / curator eligibility gates to paper over taxonomy leaks — expand `garment-taxonomy.ts` + `item-type.ts` instead.
- Skipping, half-imaging, or text-only Stage A “to save time.”
- Putting unverified overflow on the live rail.
- Junk-filling a thin bench so the rack looks full.
- Silent brand substitution (no `brand_narration`).
- LLM-invented person ids.
- Color/size as Shopify server attributes.
- Treating extraction as part of **this** search — it seeds **future** PROFILES only.
