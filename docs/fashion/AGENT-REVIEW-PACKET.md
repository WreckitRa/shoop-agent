# Shoop fashion chat agent — review packet

**Audience:** another AI (or engineer) asked to *understand, critique, and improve* the shopping agent.  
**Product:** Shoop — personal fashion shopper. Chat is **not** a free-text assistant. One pipeline owns every turn.  
**Repo:** `shoop-agent-v2`. **Date of this packet:** 2026-08-24.  
**Source of truth:** code under `src/lib/ai-chat/run-fashion-chat-stream.ts` and `src/lib/fashion-memory/**`. This packet is a map. If packet and code disagree, **code wins**.

---

## 0. How to use this packet

Share **this file plus** the six CI-hashed verbatim prompt files (do not paraphrase prompts when reviewing them):

| File | Live source | Stage |
|------|-------------|-------|
| `docs/fashion/router.md` | `src/lib/fashion-memory/router/prompt.ts` | Router (turn owner) |
| `docs/fashion/planner.md` | `src/lib/fashion-memory/search-planner/prompt.ts` | Search planner |
| `docs/fashion/extraction.md` | `src/lib/fashion-memory/extraction/prompt.ts` | Async memory clerk |
| `docs/fashion/curation.md` | `src/lib/fashion-memory/curation/prompt.ts` | Curation Stage A (vision) |
| `docs/fashion/brand_translate.md` | `src/lib/fashion-memory/brand/prompt.ts` | Unavailable-brand DNA |
| `docs/fashion/normalize_classify.md` | `src/lib/fashion-memory/normalize/llm-classify.ts` | Merchant color/size labels |

Deeper operational I/O (fetch/store per call): `docs/fashion/llm-calls.md`.  
Pre-search gates: `docs/fashion/before-ready-to-search.md`.  
Post-search find pipeline: `docs/fashion/ready-to-search-to-display.md`.  
Doctrines: `docs/fashion/doctrines.md`.  
Enums: `docs/fashion/enums.md`.

CI: `npm run check:fashion-prompts` — live prompt constants must hash-match the `## Verbatim prompt` fences.

**Review contract (read before proposing a patch):**

1. Attribute a bad find to **exactly one layer** (table in §2). Do not add a prompt ban or extra validator when the failure is upstream.
2. Code may override an LLM **only** with conversation-derived data (`stated_facts`, clarification answers). DB-only gates that ignore what she just said are doctrine violations.
3. Fallbacks must exit through the **same validators** as the happy path.
4. We do **not** own Shopify ingest. Identity is query-time taxonomy + title hard drops. Do **not** add Haiku eligibility gates or curator category bans. Do **not** junk-fill empty benches or put unverified overflow on the live rail.
5. Prefer the smallest correct change. No speculative parameters.

---

## 1. What the agent is (and is not)

**Is:** a forced-tool router that either (a) redirects off-topic, (b) asks blocking clarifications with chips, or (c) emits a structured `FashionSearchBrief` and then **plans → searches Shopify catalog MCP → hard-drops → scores → hydrates → curates with vision → speaks in stylist voice**.

**Is not:** a general chat model that writes shopping prose first and tools later. The router **never** replies in free text. Catalog ranking is not “the LLM searched.” Memory extraction does **not** block the SSE stream.

**HTTP entry:** `POST /api/chat` (`src/app/api/chat/route.ts`) → `createFashionChatSseStream` (`src/lib/ai-chat/run-fashion-chat-stream.ts`). SSE, `maxDuration` 300s (vision hang-safety). Auth required (`getAuthContext`; guests via signed `X-Guest-Session-Id`).

**Client:** `src/components/chat/chat-store.ts` always uses the fashion send path. Clarification chips: `FashionRouterControls.tsx`. Results: `FashionCurationResults` from frozen **render contract** (not raw pools).

---

## 2. Layer ownership (patch discipline)

A bad find is attributable to **exactly one** layer.

| Layer | Job | Owner | Failure mode | Illegal “fixes” |
|-------|-----|-------|--------------|-----------------|
| **L2 Interpretation** | Utterance → brief (hard vs soft) | `router/*`, `intake/post-router.ts`, swim refine | Misread her | Prompt bans for catalog leakage |
| **L3 Eligibility** | Boolean hard predicates only | `hard-drops/*` + `catalog-search/garment-taxonomy.ts` | Wrong item in bench | Haiku “is this a shirt?” gates |
| **L4 Availability** | Sized + purchasable | Hydration `verified_pool` | Showing unbuyable | Putting overflow on the live rail |
| **L5 Judgment** | Rank among eligible | `scoring/*`, curator Stage A | Bad taste on a clean bench | Eligibility rules in curator prompt |
| **L6 Composition** | Count, headers, empty/short prose | `curation/presentation.ts`, `composition-invariants.ts` | Overclaiming / junk-fill | Fake extra picks to fill the rack |
| **L0 Observability** | Boundary sizes + rejection reasons | `recordPipelineEvent`; hard_drops `rejection_samples` | Untargetable bugs | Logging without samples |

---

## 3. End-to-end turn (sequence)

```
POST /api/chat
  persist user message (dedupe consecutive dupes)
  assembleRouterContext          # roster + profiles + last 12 turns  [code]
  identity gate                  # recipient/person BEFORE router LLM  [code]
  ROUTER LLM                     # exactly one tool
      respond_off_topic       → stream reply, STOP
      ask_clarification       → sanitize/dedup/dodge → chips UI, STOP
                                (if all gaps satisfied → upgrade to search)
      ready_to_search         → FashionSearchBrief
  apply stated_facts             # people + fashion_facts  [code]
  identity gate dept/size        # may inject gate_retry LLM or templates
  finalizeBriefForSearch
  PLANNER LLM                    # plan_search → slots + query_variants
      fail → deterministic fallback plan (no second planner call)
  CATALOG MCP fan-out            # no scoring here
  brand translate LLM            # only if named brand is scarce
  normalize labels LLM           # cache/deterministic miss only
  HARD DROPS                     # department/category/item-type/size  [code]
  SCORING                        # rank survivors  [code]
  budget lift / budget-raise ask # may abort to clarification
  HYDRATION                      # size + purchasable
  provisional rack SSE           # verified options while styling finishes
  CURATION STAGE A               # Sonnet + images, never skipped
      fail/timeout → deterministic fallback + honest thin_note
  CURATION STAGE B               # Haiku voice (opening + stylist_lines)
  buildRenderContractWithTryon
  SSE fashion_catalog_search (final) + assistant text
  EXTRACTION LLM (detached)      # does not block SSE; guests skip
```

User-facing progress copy (typical):

```
Planning your search
Exploring {N} angle(s) …
Searching stores
Found {n} options for {garment}
Filtering out the misses
Checking availability and fit
Showing verified options while I finish styling
Curating picks from finalists
```

---

## 4. How it gathers information (before any search)

Preferences are **assembled**, not read from one “preferences API.”

### 4.1 Loaded into the router (every turn)

`assembleRouterContext` (`src/lib/fashion-memory/router/assemble-router-context.ts`):

| Source | What | Used for |
|--------|------|----------|
| Prisma `Message` last **12** turns | Conversation | Who, what already asked/answered |
| Fashion DB `people` (or guest snapshot) | **ROSTER** `#shortId relation (Name)` | Recipient resolution |
| `fashion_facts` + `style_signals` | **PROFILES** | Sizes, department, no-gos, budgets, taste polarity |
| Prisma `userProfile` / sizing | Self only | Fill thin fashion facts |
| Recent `metadata.fashionRouter.brief.recipient_person_id` | Sticky recipient | Continuity |
| `request_events` last 14 days | `last_search` line | Continuity |
| Onboarding seed (auth, ≤1.5s) | First-turn memory | Avoid re-asking Fitting |
| Mention scan | Create gift people **before** LLM | LLM cannot invent person ids |
| Clock | `CURRENT DATE` `YYYY-MM-DD` | Season / occasion |

**Account sizing/department apply only to `relation === "self"`.** Gift recipients never inherit the shopper’s size.

### 4.2 Profile block shape (per person)

```
## #a1b2 self (Alex)
department: shop men's
sizes: tops M, bottoms W32x30, shoes EU44
fit: tops slim
no_gos: big logos
budget_hints: general ≤ USD200 (stated)
signals: +navy [work, stated] | -logos [global, stated]
last_search: …
```

Empty person: `(no recorded facts or signals yet)`.

### 4.3 Knowledge that counts *immediately* (doctrine)

Anything stated **this conversation** (sizes, department, who, budget) is knowledge the moment it is said — same as PROFILES. The router must copy it into `stated_facts`. Asking again is a **hard failure**.

Code writes `stated_facts` via `applyStatedFacts` **before** search. Clarification chip answers land via `applyClarificationReplyFromMessage` on the next turn.

### 4.4 The Consultation Doctrine (replaces “nice-to-haves never ask”)

The router’s default is **be sure what the client wants, then search once, well** — not search-first.

Two kinds of questions:

- **Blocking** — search would be *wrong* without the answer (what / who / department / size / occasion). Unchanged.
- **Consultative** — search would be *different* depending on the answer (depth, preference_anchor, budget, style_lane, color, brand, fit, formality, direction). **Allowed and expected** when the answer would change what a stylist pulls and conversation + PROFILES do not already answer it.

Consultation budget: one round by default, a second only if the first answer opened a real fork. Hard cap in code: 2 consultative rounds per brief, then search. Blocking rounds do not count. Every consultative question carries a “You decide” chip; every consult turn carries a “Just show me” escape. Speed signals (“just go”, “yalla”, “vas-y”) are LLM intent, not regex — stop consulting and list `brief.assumptions`.

`known_summary` is the “I know you” line on every consult turn. Assumptions the router made without asking live in `brief.assumptions[]` and must be voiced on results.

Repeat clients get asked less: `shopping_style:quick` and `depth_default` in PROFILES skip consultative questions / depth asks.

### 4.5 Blocking gaps still exist (priority)

1. **WHAT** — no garment and no inferable shopping direction
2. **WHO** — not obvious self vs mentioned person (default **self** if no gift cue). Unique roster relation (`my mother` + one mother) → resolve **silently**
3. **NEW PERSON ESSENTIALS** — department + sizes for garments in play (name optional if relation unique)
4. **OCCASION / USE** — garment clear, event unclear
5. **SIZE** for a registered person when PROFILES lack that bucket

Bundle **all** currently-blocking gaps into **one** turn, max **4** questions, each with 2–5 `quick_options`. UI always adds Other (except `person_name` → Skip only).

**Dodge:** same blocking gap asked twice and declined → proceed with `knowledge_state` unconfirmed. Interrogation is worse than an unconfirmed size.

### 4.6 Identity is code, not the LLM

`intake/identity-gate.ts` + `people.ts`: recipient (existing roster vs `"new"`) is resolved **in code before** the router LLM registers facts. Never trust the LLM to invent `recipient_person_id`.

After `ready_to_search`, code **re-checks** department + sizes. If still missing: `gate_retry` system note + second router call, or deterministic templates (`buildBlockingClarification`).

### 4.7 Async memory (does not help *this* search)

After SSE ends, `extraction/spawn.ts` runs a detached clerk LLM. It records **person** facts/signals for **future** PROFILES. Item-only request attributes (`"a black shirt"`) are **not** extracted. Guests skip.

Onboarding Fitting free-text and background profile extractor seed the same stores later (`docs/fashion/llm-calls.md` calls 8–9).

---

## 5. Router (L2) — the turn owner

| | |
|---|---|
| Code | `src/lib/fashion-memory/router/llm-router.ts` |
| Prompt | `ROUTER_PROMPT_STATIC` in `router/prompt.ts` — **verbatim in `docs/fashion/router.md`** |
| Tools | `respond_off_topic` \| `ask_clarification` \| `ready_to_search` |
| Model | Sonnet (`FASHION_ROUTER_MODEL`); Opus (`FASHION_ROUTER_ESCALATION_MODEL`) when `assessRouterEscalation` trips |
| Params | `max_tokens=2048`, `tool_choice=any`. **Omit `temperature`** (Sonnet 5 / Opus 4.7+ → API 400) |
| Cache | Static prefix cached; roster/PII **only** in uncached suffix |

**System as sent:**

1. Cached: entire `ROUTER_PROMPT_STATIC`  
2. Uncached suffix (`buildFashionRouterContextBlock`):

```
--- CONTEXT ---
{ROSTER}

{PROFILES}

CURRENT DATE: {DATE}
```

When `consultation_budget_spent` (2 consult rounds used this brief), the uncached suffix appends after the date:

```
CONSULTATION BUDGET SPENT — call ready_to_search and list assumptions.
```

That line is the appointment cap. It is not in the cached prefix. Blocking rounds do not set it.

**Messages:** last 12 chat turns. Newest user message last.

**Default:** be sure what they want and at what depth, then `ready_to_search` once. Search immediately when the brief is already complete, they signal speed, or the consultation budget is spent — not because search is the bias. Unasked consultative calls go in `brief.assumptions[]`. Minimum viable brief: garments + recipient + sizes for those garments + rough occasion.

**Brief fields (ready_to_search):**

```
recipient_person_id, request_type, garments[], occasion_context,
quantity_hint, must_haves[], nice_to_haves[],
budget_context { stated, max?, currency?, scope?: per_item|total },
style_direction,
department_scope?,
color_direction { source: stated|profile|none, stated_colors? },
brand_direction { source: stated|profile|none, brands? },
stated_facts?
```

`request_type`: `single_item` | `outfit` | `capsule` | `multi_item`.  
**Shopping intent is owned by the router LLM.** Code does **not** keyword-coerce `request_type` or invent garments/occasion. Accessories and swim nouns pass through verbatim — never coerce into shirts.

Post-router: `intake/post-router.ts` (dedup, dodge-count, declined gaps). `checkBriefInvariants` fires `invariant_warning` for accessories-coercion and unknown families (`/flagged`).

Parse failure → `FALLBACK_CLARIFICATION`: “What are you looking for — a single piece, or a full look?”

---

## 6. Search planner — how it “plans”

| | |
|---|---|
| Code | `plan-from-brief.ts`, `llm-planner.ts`, `fallback-plan.ts` |
| Prompt | **verbatim `docs/fashion/planner.md`** |
| Tool | `plan_search` exactly once |
| Model | Haiku `FASHION_SEARCH_PLANNER_MODEL` |
| Fail | Deterministic plan — **no second LLM call** |

**User message:**

```
CURRENT DATE: {YYYY-MM-DD}

BRIEF (JSON):
{FashionSearchBrief}

RECIPIENT PROFILE:
{same profile formatter, recipient only}
```

**Job:** decompose the brief into **slots** (garment categories) the way a stylist pulls a showroom:

| `request_type` | Slots |
|----------------|--------|
| `single_item` | Exactly 1 |
| `outfit` | One slot per garment a stylist would pull; exactly one `anchor`; others `support` |
| `capsule` | Mixable set, **shared palette**; options from rotation count |
| `multi_item` | Independent anchors, no coherence coupling |

Per slot: `garment`, `role`, `style_direction`, `palette_constraint` / `palette_source`, `options_wanted` (1–8), `query_variants` (4–5 strings, best→worst), optional `budget_fraction` (outfit/capsule with stated budget, sum=1).

**Query string rules (planner prompt):** department word first when known; product type + 2–3 descriptors; **banned:** sizes, recipient words, occasion-as-purpose, quantity/price, “outfit/look/capsule”. At most **one** variant may carry a color. Stated brand → variant 1 is `"<brand> <department> <garment>"`.

**Code after planner (`finalizeResolvedPlan`):**

1. Clamp (`MAX_PLAN_SLOTS = 12`)  
2. Outfit/capsule underflow → **deterministic expand** (still no second LLM)  
3. Drop style-phrase “garments” (`isStylePhraseGarment`)  
4. Reconcile missing brief garments as support slots  
5. Invariants + `budget_allocation` (`padded_max`, `guardMaxMajor`)

FX: `prefetchFxRates` before hard drops filter on price.

---

## 7. How it searches (catalog) — no LLM

`searchFashionCatalogPlan` → per-slot `searchCatalogForSlot`:

1. Buyer context: country, currency, language  
2. `composeSlotIntentString` — ranking **hint** for MCP, not a filter  
3. Primary query variants, then spare, then reformulation if thin  
4. Shopify / UCP `search_catalog` via MCP  
5. Timeouts: hedge **3s**, hard **10s**; target ~100 hits per path  
6. Dedupe → cards with `image_urls`

**Server filters (always):** `available: true`, `ships_to` country.  
**Conditional:** price (honor vs scout lane), taxonomy categories, target gender (Male+Unisex / Female+Unisex) on category lanes.  
**Never sent as server attributes:** color, size (merchant free-text silently empties inventory). Matching is **client-side** after normalize.

Brand: if stated brand pool is thin, **brand-translate LLM** (`docs/fashion/brand_translate.md`) produces style descriptors **not competitor names**; cached in `brand_translations`. Silent substitution is forbidden — `brand_narration` must appear in the assistant reply.

---

## 8. Hard drops, scoring, hydration (code)

### 8.1 Normalize (conditional LLM)

Merchant color/size labels → canonical buckets. Cache + deterministic + fuzzy first; LLM (`docs/fashion/normalize_classify.md`) on miss. Fail-open at **10s**.

### 8.2 Hard drops (L3, final)

`applyHardDropsForSlots` → `applyHardDrops`. A drop means **cannot be shown**, even as curator tier-2.

Rules include: `unavailable`, `budget`, `department_mismatch`, `category_mismatch`, `item_type_mismatch`, `size_mismatch`, color/material must-have and no-go.

Events must include `rejection_samples` (product_id + rule + evidence). Tripwires: `EXCESSIVE_DROP_RATIO`, `JUNK_FILL_RATIO`.

**Suspicions** (not kills) travel to the curator: `no_price`, `size_unknown`, `color_unknown`, `attire_conflict_title`, `price_outlier_low`, …

### 8.3 Scoring (L5 rank, not eligibility)

`scoreProduct` → `final`; `stableSortProducts` (ties by original index).

| Component | Weight |
|-----------|--------|
| `shopify_rank` | 0.32 |
| `brand_match` | 0.20 |
| `corroboration` | 0.11 |
| `palette` | 0.11 |
| `size_confirmed` | 0.09 |
| `rating` | 0.09 |
| `department_confirmed` | 0.08 |
| suspicion | 0.03 / flag, cap 0.08 |

`SCORING_WEIGHTS_VERSION = "20260709-v3-brand"`. Also: attire-conflict penalties, price-outlier suspicion.

### 8.4 Budget

`budgetAllocation.ts` from `budget_context`. Thin outfit/capsule → lift (re-admit then optional re-query) or **budget_raise_ask** (abort search → clarification). Declined twice → stop blocking.

### 8.5 Hydration (L4)

Product detail MCP; size/availability. Outputs `verified_pool` vs `overflow_items`. **Only verified items are finds.** Unverified overflow is not live rail.

Then **provisional rack** SSE (`provisional: true`) so she sees options while Stage A runs. Outfit/capsule: `synthesizeOutfitLooks` so looks are never empty on the provisional path.

---

## 9. Curation — judgment + voice

### 9.1 Stage A (vision) — never skipped

| | |
|---|---|
| Code | `curation/run-curation.ts` |
| Prompt | **verbatim `docs/fashion/curation.md`** (`CURATION_PROMPT_SKELETON` + mode sections) |
| Tool | `deliver_curation` |
| Model | Sonnet `FASHION_CURATION_MODEL` (default `claude-sonnet-5`) |
| Hang-safety | `CURATION_SAFETY_MS` / `CURATION_STAGE_A_HARD_MS` default **180s** outer abort — **not** a quality budget to skip vision |

**House rules (prompt):** exclusions from images; verify attire / department / color (**trust photo over label**) / fit-to-brief; veto clearly wrong; no near-twins; honesty on converted/unknown sizes; state brand outcome; budget sums; one stylist sentence per pick (refined in B); thin/degraded → honest `thin_note`.

**Image budget:** single/multi 6; outfit 4 per slot; capsule 6/4; 512px JPEG. Overflow is text refs only.

**Deliverable caps:** 3 hero picks; 3 looks / capsule outfits.

On LLM failure or outer abort: `buildDeterministicFallback` + `validateAndRepairFallback` — honest rack, **no hallucinated picks**. Do **not** skip Stage A from clock pressure (historical incident: `docs/fashion/qa-incident-curation-skip-0e1c21fa.md`).

### 9.2 Stage B (voice)

`curation/voice.ts` — Haiku, text-only, `deliver_curation_voice`. Opening ≤2 sentences + one `stylist_line` per pick. Empty → retry → deterministic templates (`voice_fallback`). Never ship Stage A placeholders (“Fitting room ready.” / “See card.”).

### 9.3 Render contract (client)

UI renders `render` only (`RENDER_CONTRACT_VERSION = 1`). Client metadata: `fashionCatalogSearch` / `fashionRouter` — **never** raw pre-drop pools. `ruled_out` / `dropped` on slots = debug reasons, never ids outside the survivor pool.

`buildRenderContractWithTryon` attaches avatar-fit imagery. Try-on FASHN is **not** an LLM (`src/lib/tryon/**`).

---

## 10. Extraction (memory clerk)

| | |
|---|---|
| Prompt | **verbatim `docs/fashion/extraction.md`** |
| Tool | `record_fashion_ops` |
| Gate | `extraction/gate.ts` — short acks only extract when the previous assistant turn was soliciting |
| Spawn | Detached; never blocks SSE |

Procedure: PERSON vs ITEM → which person (aliases, `new:1`) → KNOWN / GENERAL / THIS-PURCHASE-ONLY. Dislikes while shopping generalize more than likes. Ambiguous subject → record nothing. Application layer owns precedence (`applyFashionOps`). Evidence quote must appear in `[NEW]` text.

---

## 11. Auxiliary LLM calls (not the shopping brain)

Documented in `docs/fashion/llm-calls.md`: conversation title, suggested placeholder, clarification palettes, clarification preview vision, PDP swatches, Fitting free-text, onboarding extractor, Studying Scan try-on verdict.

These must not become a second chat path.

---

## 12. Models (defaults; env overrides win)

From `src/lib/fashion-memory/models.ts` + `src/lib/ai-chat/constants.ts`:

| Knob | Default | Stage |
|------|---------|-------|
| `AI_CHAT_LIGHTWEIGHT_MODEL` | `claude-haiku-4-5-20251001` | Router, planner, extract, titles, palettes |
| `AI_CHAT_DEFAULT_MODEL` | `claude-opus-4-8` | Router escalation only |
| `FASHION_CURATION_MODEL` | `claude-sonnet-5` | Stage A vision |
| `FASHION_CURATION_VOICE_MODEL` | Haiku | Stage B |

Opus 4.7+ / Sonnet 5: **omit custom `temperature`** (API 400).

---

## 13. Observability

Every stage emits `recordPipelineEvent` keyed by `traceId`. Compact copies on `MessageMetadata.fashionPipelineEvents` (debug panel). Prompt-cache hit rate + curator latency on `/api/health`. Hard-drop events: `rejection_samples`, not counts only.

Regression: `src/lib/fashion-memory/fixtures/*.test.ts` (joe, swimwear, accessories, department, person-identity, …). E2E: `e2e/e2e.test.ts` (`npm run test:e2e`, goldens `npm run test:e2e:golden`).

---

## 14. Known constraints / improvement surfaces

Prioritize proposals by: (1) pick quality vs brief, (2) latency/cost under pocket budgets, (3) honesty when inventory/budget is thin, (4) outfit/capsule coherence (looks never empty).

Keep: never-skip Stage A, provisional rack, lean image budgets, style-phrase sanitize, hard drops as final, stated-facts-as-knowledge, layer ownership.

Open surfaces:

1. Latency stack: planner + 10s catalog + 10s normalize fail-open + hydration waves + Sonnet A + Haiku B.  
2. Color/size not server-filtered — quality depends on normalize + hard drops.  
3. Listing photos ≠ styled outfits until curator/synthesizer composes looks.  
4. Thin slots / `unknown_family` taxonomy gaps.  
5. Budget lift vs interrupt-to-raise-ask.  
6. Dual UI: missing `render` falls back to raw catalog cards.  
7. Guest vs auth memory (snapshot vs server facts).  
8. Measurements stored but **not yet consumed** by search/try-on (`enums.md`).  
9. Router over-clarifying vs under-clarifying (identity gate vs prompt).  
10. Planner query vocabulary vs catalog recall.

**Evals to propose against, not instead of:** fixture tests, kill-rate + rejection_samples, curator veto rate, Stage A rung distribution, golden e2e traces, `/flagged` invariant warnings.

---

## 15. File map (critical path)

| Path | Role |
|------|------|
| `src/app/api/chat/route.ts` | HTTP → SSE |
| `src/lib/ai-chat/run-fashion-chat-stream.ts` | Orchestrator |
| `src/lib/fashion-memory/router/*` | L2 brief |
| `src/lib/fashion-memory/intake/*` | Identity, stated_facts, dedup, dodge |
| `src/lib/fashion-memory/search-planner/*` | Slots + queries |
| `src/lib/fashion-memory/catalog-search/*` | MCP fan-out |
| `src/lib/fashion-memory/hard-drops/*` | L3 |
| `src/lib/fashion-memory/scoring/*` | L5 rank |
| `src/lib/fashion-memory/budget/*` | Caps, lift, raise-ask |
| `src/lib/fashion-memory/hydration/*` | L4 |
| `src/lib/fashion-memory/curation/*` | Stage A/B, presentation, render |
| `src/lib/fashion-memory/extraction/*` | Memory clerk |
| `src/lib/tryon/attach-render.ts` | Try-on on contract |
| `src/lib/fashion-memory/fixtures/*.test.ts` | Production-trace regressions |

---

## 16. Task for the reviewing agent

You are reviewing Shoop’s **only** chat path: forced-tool router → planner → Shopify catalog MCP → hard drops → score → hydrate → vision curator → voice → render contract.

**Do:**

- Read this packet and the six verbatim prompt files listed in §0.  
- Propose a short list of improvements, each tagged with **layer L2–L6** (or L0).  
- For each: problem, evidence (prompt clause / code file), smallest change, risk, how to test (name a fixture or e2e scenario if possible).  
- Call out prompt vs code ownership. If the router prompt and identity-gate disagree, say which should win and why (doctrine: stated_facts + conversation).  
- Preserve: consultation doctrine (search when sure — not search-first), no junk-fill, no unverified live rail, no LLM-invented person ids, no silent brand swap.

**Do not:**

- Invent a second chat model that “just talks.”  
- Add category bans to the curator to paper over taxonomy leaks.  
- Skip or half-run Stage A “to save time.”  
- Coerce `request_type` with keyword lists in code.

Return: (1) architecture understanding in ≤15 bullets, (2) ranked improvement list, (3) explicit non-goals.
