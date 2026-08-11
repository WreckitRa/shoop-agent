# Shoop fashion pipeline rules

Fashion memory is the only chat path (`run-fashion-chat-stream.ts`). Corrections from
production traces become **regression tests** in `src/lib/fashion-memory/fixtures/`
and rules here.

## Layer ownership (stop patching the wrong stage)

A bad find is attributable to **exactly one** layer. Do not add another validator
or a prompt ban when the failure is upstream.

| Layer | Job | Owner | Failure mode |
|-------|-----|-------|--------------|
| **L2 Interpretation** | Utterance → brief (hard vs soft) | `router/*`, `intake/post-router.ts`, swim refine | Misread her |
| **L3 Eligibility** | Boolean hard predicates only | `hard-drops/*` + `garment-taxonomy.ts` | Wrong item in bench |
| **L4 Availability** | Sized + purchasable on the rack | Hydration verified pool; presentation never ships unverified | Showing unbuyable |
| **L5 Judgment** | Rank among eligible | `scoring/*`, curator Stage A | Bad taste on a clean bench |
| **L6 Composition** | Count, headers, empty/short prose | `presentation.ts`, `composition-invariants.ts` | Overclaiming / junk-fill |
| **L0 Observability** | Boundary sizes + rejection reasons | `recordPipelineEvent`; hard_drops `rejection_samples` | Untargetable bugs |

**We do not own Shopify ingest.** Offline "identity warehouse + quarantine" is not
available here. Identity is query-time taxonomy filters + title item-type hard drops.
Expand those tables when a family leaks; do **not** add Haiku eligibility gates or
curator prompt category bans. Do **not** junk-fill empty benches or put unverified
overflow on the live rail.

## Turn flow

1. **Router** (`fashion-memory/router/*`, `llm-router.ts`) — one forced-tool LLM call per
   turn: `respond_off_topic`, `ask_clarification`, or `ready_to_search` (→ `FashionSearchBrief`).
   `intake/identity-gate.ts` resolves recipient/person before the LLM call; `intake/post-router.ts`
   applies dedup, dodge-counting, and declined-gap tracking.
2. **Search planner** (`fashion-memory/search-planner/*`) — turns a validated brief into
   per-slot retrieval queries (`plan-from-brief.ts`, `query-builder.ts`, `deterministic-builder.ts`
   fallback when the LLM planner fails).
3. **Catalog search** (`fashion-memory/catalog-search/*`) — fans the plan out to the UCP
   catalog per slot; no scoring/normalization at this stage.
4. **Hard drops** (`fashion-memory/hard-drops/*`) — deterministic survivor gate
   (`applyHardDropsForSlots` → `applyHardDrops`) for department/category/item-type/size
   mismatches. Never scoring — a drop here means the product cannot be shown at all.
5. **Scoring** (`fashion-memory/scoring/*`) — `scoreSlotProducts` ranks survivors
   (`components.ts`, `attire-conflict.ts`, `palette-match.ts`, `weights.ts`).
6. **Curation** (`fashion-memory/curation/*`) — `run-curation.ts` calls the curator LLM
   (`build-input.ts`, `prompt.ts`, `tool-schema.ts`) with deterministic fallback
   (`fallback.ts`) and voice fill (`voice.ts`); output validated (`validate.ts`) and
   rendered (`presentation.ts`, `build-render-contract.ts`).
7. **Try-on render** — `buildRenderContractWithTryon` (`lib/tryon/attach-render.ts`)
   attaches avatar-fit imagery to the curation contract before it reaches the client.

## P0 — Trust / correctness

### Hard drops are final (`hard-drops/apply-hard-drops.ts`, `orchestrator.ts`)
- Department/category/item-type/size mismatches are dropped before scoring ever runs.
- **Rule:** a hard-drop violator never reaches curation, even as a tier-2 demotion.
- Excessive-drop and price-bound "junk fill" ratios are tripwires
  (`EXCESSIVE_DROP_RATIO`, `JUNK_FILL_RATIO`) logged via `recordPipelineEvent` /
  `logAiChat("warn", ...)` — investigate before trusting a slot's survivors.
- Hard-drop events include `rejection_samples` (product_id + rule + evidence), not
  only aggregate counts.

### Availability + composition (`curation/presentation.ts`, `composition-invariants.ts`)
- Only hydrated verified items enter live presentation tiers — unverified is not a find.
- Headers prefer survivor contents (`displayGarmentFromSurvivors`); short/empty benches
  get honest `thin_note` with no backfill.
- Header↔contents and duplicate-id mismatches emit `invariant_warning`.

### Brief invariants (`observability/invariants.ts`)
- `checkBriefInvariants` fires `invariant_warning` for accessories-coercion and
  unknown garment families — surfaces on `/flagged`. Shopping intent
  (outfit vs single_item, occasion) is owned by the router LLM; code does not
  keyword-coerce `request_type` or invent garments/occasion.

### Identity gate (`intake/identity-gate.ts`, `people.ts`)
- Recipient resolution (existing roster person vs. `"new"`) happens in code before
  the router LLM call registers stated facts — never trust the LLM to invent a
  `recipient_person_id`.

### Narration contract (`curation/presentation.ts`, `build-render-contract.ts`)
- The client only ever receives `fashionCatalogSearch` / `fashionRouter` metadata —
  never raw pre-hard-drop or pre-score pools.
- `ruled_out` / `dropped` on each slot carries hard-drop + suspicion reasons for
  the debug panel, never product ids outside the slot's survivor pool.

## P1 — Quality

### Budget (`fashion-memory/budget/*`)
- `budgetAllocation.ts` resolves per-slot caps (`padded_max`, `guardMaxMajor`)
  from the brief's `budget_context`; `budget-raise-ask.ts` handles mid-thread
  budget-raise clarifications.
- Currency conversion goes through `prefetchFxRates` before hard drops filter on price.

### Scoring components (`scoring/components.ts`, `weights.ts`)
- `scoreProduct` blends shopify rank, palette match, attire-conflict penalties, and
  price-outlier suspicion into a single `final` score used for stable ranking
  (`stableSortProducts`, ties broken by original index).

### Curation degradation (`curation/degradation.ts`, `fallback.ts`)
- Stage A always runs full vision. Hang-safety only (`CURATION_SAFETY_MS` /
  `CURATION_STAGE_A_HARD_MS`, default 180s) — never half-images / text-only /
  deterministic from clock pressure. After that outer abort (or LLM failure),
  `buildDeterministicFallback` + `validateAndRepairFallback` keep the rack
  honest instead of hallucinating picks.

### Clarification hygiene (`intake/clarification-dedup.ts`, `intake/dodge-counter.ts`)
- `checkReaskAfterAnswer` blocks re-asking something the user already answered.
- Gaps declined twice (`isGapDeclined`) stop blocking search — proceed with
  `knowledge_state` marked unconfirmed rather than looping the user.

### Memory extraction (`fashion-memory/extraction/*`, `onboarding/memory-extract/*`)
- Onboarding profile → fashion memory via `seed-fashion-memory.ts` (Prisma profile
  projection).
- Turn-level extraction runs through `extraction/gate.ts` (cost gate — short acks
  only extract when the preceding assistant message was soliciting) and
  `extraction/spawn.ts` (detached, never blocks the SSE stream).

## P2 — Observability

### Pipeline trace (`observability/trace.ts`, `pipeline-event-payloads.ts`)
- Every stage (router, planner, catalog-search, hard-drops, scoring, curation)
  emits `recordPipelineEvent` rows keyed by `traceId`; compact/truncated copies
  land on `MessageMetadata.fashionPipelineEvents` for the debug panel.

### Prompt cache + latency (`observability/prompt-cache-metrics.ts`, `curation/latency-metrics.ts`)
- Track prompt-cache hit rate and curator LLM call latency; hang-safety ceilings
  live in `pipeline-cutoffs.ts` (long outer aborts only — not quality budgets).

## Regression discipline

- Fixtures: `src/lib/fashion-memory/fixtures/*.test.ts` (accessories, department
  enforcement, joe-incident, person-identity, pre-search-v2, voice-stage-b,
  swimwear-incident, etc.) — each encodes a specific production trace correction.
- E2E golden traces: `e2e/e2e.test.ts` (`npm run test:e2e`, update goldens with
  `npm run test:e2e:golden`).
- Run: `npm test`
