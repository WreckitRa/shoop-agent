# Shoop fashion pipeline rules

Fashion memory is the only chat path (`run-fashion-chat-stream.ts`). Corrections from
production traces become **regression tests** in `src/lib/fashion-memory/fixtures/`
and rules here.

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

### Brief invariants (`observability/invariants.ts`)
- `coerceBriefRequestTypeForOutfitLanguage` upgrades single/multi-item briefs to
  `outfit` when the user said "outfit"/"look"/"head to toe".
- `checkBriefInvariants` fires `invariant_warning` pipeline events for
  accessories-coercion, unknown garment families, and occasion language dropped
  from the brief — these surface on `/flagged`.

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
- When the curator LLM fails or times out (`CURATION_HARD_MS`,
  `CURATION_SHRINK_RETRY_MS`), `buildDeterministicFallback` + `validateAndRepairFallback`
  keep the rack honest instead of hallucinating picks.

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
- Track prompt-cache hit rate and curator LLM call latency; curation has hard/soft
  time cutoffs (`pipeline-cutoffs.ts`) that trigger the deterministic fallback path.

## Regression discipline

- Fixtures: `src/lib/fashion-memory/fixtures/*.test.ts` (accessories, department
  enforcement, joe-incident, person-identity, pre-search-v2, voice-stage-b, etc.) —
  each encodes a specific production trace correction.
- E2E golden traces: `e2e/e2e.test.ts` (`npm run test:e2e`, update goldens with
  `npm run test:e2e:golden`).
- Run: `npm test`
