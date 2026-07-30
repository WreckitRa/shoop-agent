# Find-pipeline QA incident: curation never ran (outfit looks missing)

> **Audience:** the AI / engineer who authored the *Find Pipeline – Final Optimization Plan* (Phase 0/1 cutoffs, provisional rack, Stage A/B split, turn budget).  
> **Purpose:** empirically show what the new cutoffs did on a real outfit run, so recommendations can be revised without guessing.  
> **Date:** 2026-07-29  
> **Environment:** local/dev with Phase 0+1 changes live (Sonnet curation, effort off, max_tokens 2000, split on, provisional on, Phase‑1 turn budget 45s).  
> **Inspect:** `/admin/fashion/0e1c21fa-81c8-486d-82e7-0eabcfd2aff1`

---

## 0. One-line verdict

**Curation did not fail — it was never invoked.** The Phase‑1 **45s turn budget** fired `fashion_turn_budget_skip_curation` after ~39s of pre-curation work (~6s remaining &lt; 8s reserve). The UI got a **provisional / deterministic fallback rack with `looks: []`**, so outfit mode rendered **“Top picks” (per-slot heroes) instead of named clothing combos**. The optimization plan’s “contract ALWAYS mounts” path mounted a screen that is **structurally incomplete for outfit**.

---

## 1. QA identity

| Field | Value |
|--------|--------|
| `trace_id` | `0e1c21fa-81c8-486d-82e7-0eabcfd2aff1` |
| Message id | `cms62eg8l000efqeaddwkye1s` |
| Conversation | `cms62cuoi0002fqea1eevgw06` |
| Route | `ready_to_search` |
| Mode | `outfit` |
| User-visible failure | No “Three looks” / no combo outfits — only slot picks |
| Admin degradation | `degradation_kind: curation_fallback` |
| Pipeline flags | `unknown_garment_family`, `validator_fallback_query_variants`, `scoring_top10_suspicious` |

---

## 2. What the user asked for (product intent)

Outfit for a **day party, laid-back cool** mens look:

- Sizes stated: tops XL, bottoms US34, shoes EU44  
- Department: mens  
- Style: effortless, unique, no loud logos / synthetic sheen; avoid skin-tight / super cropped  
- Brands from profile: Banana Republic, Massimo Dutti, Uniqlo  
- No stated budget  

Router brief garments (problem seed):

```json
["cool style laid back", "shirt", "bottoms", "shoes"]
```

`"cool style laid back"` is a **style phrase coerced into a garment slot**, not a SKU family. That polluted the plan (4th support slot, `unknown_family: true`) and burned fan-out / normalize / hydrate budget on a junk lane — but it is **not** why looks vanished. Looks vanished because Stage A never ran.

---

## 3. Timeline (wall clock)

Trace created: `2026-07-29T12:32:23Z`  
HTTP: `POST /api/chat 200 in 81s` (`summary.total_ms: 80207`)

| When (UTC) | Stage | Notes |
|------------|--------|--------|
| 12:32:23 | trace start | |
| 12:32:32 | router Haiku | ~4.0s, 6749→301 tok |
| 12:32:41 | planner Haiku #1 | ~6.3s |
| 12:32:47 | planner Haiku #2 | ~5.6s (retry / second pass) |
| 12:33:10 | normalize LLM | **aborted** (`error: "Request was aborted."`, latency_ms 10002) — matches **NORMALIZE_HARD_MS = 10s** |
| 12:33:10 | normalize pipeline event | `ms: 20106` wall for whole normalize stage |
| 12:33:16–25 | hydration (×4 slot waves) | ~5–9s per wave; aggregate ~13.7s in plan_complete |
| **~12:33:25** | **would start curation** | **skipped** — see §4 |
| 12:33:57 | extraction (detached) | after turn; irrelevant to looks |

### Server log (smoking gun)

```text
[ai-chat:warn] fashion_turn_budget_skip_curation {
  traceId: '0e1c21fa-81c8-486d-82e7-0eabcfd2aff1',
  turn_budget_ms: 45000,
  elapsed_ms: 38862,
  remaining_ms: 6138
}
```

Then:

```text
fashion_catalog_plan_complete {
  mode: 'outfit',
  slot_count: 4,
  total_products: 716,
  verified_pool: 40,
  timing_ms: 2473,          // catalog fan-out only — NOT full turn
  normalize_ms: 20106,
  hard_drop_ms: 73,
  scoring_ms: 23,
  hydration_ms: 13660,
  curation_ms: 2,           // effectively zero — skip path
  curation_fallback: true
}
```

**Decision rule in code (Phase 1):** if `turnDeadline - now < 8000ms`, do not call `runFashionCuration`; ship `buildProvisionalPresentation` instead.

Arithmetic: `45000 - 38862 = 6138 < 8000` → skip.

---

## 4. Proof curation never ran

### 4.1 `llm_calls` for this trace

| stage | model | latency_ms | error |
|--------|--------|------------|--------|
| router | Haiku | 4022 | — |
| planner | Haiku | 6259 | — |
| planner | Haiku | 5602 | — |
| normalize_llm | Haiku | 10002 | **Request was aborted.** |
| extraction | Haiku | 5440 | — |

**There is no `stage: "curation"` row.** Stage B voice also never ran (no voice call).

### 4.2 Pipeline events

Stages present: router_context, validators, ucp_query, normalize, hard_drops, scoring, hydration…  

**Absent:** `curation`, `curation_fallback` event stage (fallback was applied in catalog assembly without a successful LLM curation stage), curator_veto.

### 4.3 Persisted presentation

| Field | Value |
|--------|--------|
| `curation.meta.mode` | `outfit` |
| `curation.meta.fallback` | `true` |
| `curation.looks` | `[]` (length 0) |
| `render.looks` | `[]` |
| `curation.narration.opening` | `"Pulling the strongest verified options onto the rack…"` (provisional copy) |
| `curation_vetoes` | none (curator never saw images) |

UI gate (`FashionCurationResults`):

```ts
const isOutfit = mode === "outfit" && (render.looks?.length ?? 0) > 0;
```

With `looks.length === 0`, outfit mode falls through to **“Top picks”** — no combo looks section.

---

## 5. Why the turn budget was already spent

Approximate spend before the curation gate (from logs + llm_calls):

| Bucket | ~ms | Notes |
|--------|-----|--------|
| Router | 4,000 | |
| Planner ×2 | 12,000 | second planner call is a silent multiplier |
| Catalog fan-out | ~2,500 | admin “2473ms catalog” — **misleading as end-to-end** |
| Normalize | ~20,000 | hard cutoff aborted LLM at 10s; stage wall still ~20s |
| Hydration | ~14,000 | 4 outfit slots, verified_pool 40 |
| **Sum at skip** | **~38,900** | vs **45,000** budget |
| Reserve needed | 8,000 | for Stage A |
| Remaining | **6,138** | **insufficient** |

So the cutoffs did what they were designed to do *individually*, but the **global turn budget assumed a thinner pre-curation stack** than a real 4-slot outfit with planner retry + normalize abort.

### Interaction with other Phase‑0/1 cutoffs

| Cutoff | Behavior on this run | Side effect |
|--------|----------------------|-------------|
| `NORMALIZE_HARD_MS` 10s | Abort normalize LLM | Labels left unresolved → more hydrate/score noise; still costs wall time |
| `HYDRATION_WAVE_HARD_MS` 12s | Waves completed under cutoff | Still ~14s aggregate across slots |
| `TURN_BUDGET_PHASE1_MS` 45s | Skip curation | **Kills the deliverable that needs the LLM** |
| Stage A 18/25s | Never reached | — |
| Provisional rack | Mounted without looks | User sees a rack, not outfits |

**Sizing-law conflict:** The plan said “if p50 grows past half the cutoff, shrink the call — never raise the cutoff.” Here the **turn budget acted as a guillotine on the most important call**, while upstream calls (planner retry, normalize abort path) were allowed to consume the budget without shrinking. That recreates the July lesson at turn scope: **timeout/budget without shrinking upstream = degraded product after waiting anyway**.

---

## 6. Admin QA criteria (as pasted) — mapped to root cause

| Admin field | Observed | Relevance |
|-------------|----------|-----------|
| `degradation_kind: curation_fallback` | Yes | Correct label; mechanism was **skip**, not LLM timeout/parse fail |
| `curation_vetoes: none` | Yes | No curator |
| `hydration_summary` | killed.gone 1; size confirmed 8 / unknown 32 | Inventory was usable (40 verified) — not a thin-pool story |
| `drops_by_rule` | unavailable / item_type / department | Normal filtering; not causal |
| `plan.plan_source: clamped` | Yes | Planner quality issues present |
| `unknown_garment_family` | On bottoms + **cool style laid back** | Extra slot tax; secondary |
| Catalog `2473ms` | Fan-out only | **Do not use as turn latency**; turn was 80s |
| Survivors 14 in one admin panel | Slot-scoped view | Full plan had 716 hits / 40 verified across slots |

---

## 7. Secondary defects (same run, not the looks root cause)

These should still be fixed, but they did **not** empty `looks` by themselves:

1. **Router emitted `"cool style laid back"` as a garment** → 4th slot, `unknown_family`, nonsense queries (`mens laid-back cool cool style laid back`). Style descriptors must not become slots.
2. **Bottoms `unknown_family: true`** with weak queries (`mens laid-back cool bottoms`) → scoring suspicions.
3. **Planner ran twice** (~12s) before catalog — turn budget does not account for planner retries.
4. **Normalize abort at 10s** left a large unresolved-label set (1788 labels in admin normalize overview) while still charging ~20s to the turn clock.
5. **Deterministic fallback / provisional does not synthesize outfit `looks`** (capsule gets `capsule_outfits`; outfit gets none). So any skip/fallback path **guarantees** no combo UI for outfit mode.

---

## 8. What the optimization plan expected vs what happened

| Plan claim | This run |
|------------|----------|
| Phase 1 first meaningful paint ~3–6s provisional | Provisional eventually mounted, but only after ~39s of upstream work — not 3–6s |
| Heroes / Stage A ~12–15s | Stage A **never started** |
| Fallback = visible rack, not a cliff | Rack visible, but **outfit product incomplete** (no looks) — softer cliff, still a product fail |
| Turn budget 45s; contract ALWAYS mounts | Contract mounted **without** the outfit deliverable |
| Shrink the call, then cutoffs are tripwires | Turn budget raised the guillotine on curation while upstream stayed fat |

---

## 9. Recommended fixes (for the recommending AI to validate)

Priority order from this incident:

### P0 — Product correctness

1. **Never skip Stage A solely because turn budget is tight without synthesizing outfit looks.**  
   - Either: always run Stage A with a **shrunk** call (text-only / half images / 15s) when remaining is low, **or**  
   - Extend `buildDeterministicFallback` / provisional to emit **1–3 outfit looks** (one pick per slot, named “Look 1…”), same as capsule pairing already does.

2. **Turn budget must reserve curation.**  
   Example: `turnDeadline` should leave `CURATION_STAGE_A_HARD_MS` (or shrink budget) **earmarked** from t=0, and only starve catalog/normalize retries — not Stage A.  
   Or: start turn-budget accounting **after** hydration (“curation SLA”), matching the plan’s Stage A table, not wall-clock from router.

3. **Do not count a mounted contract as success for outfit unless `looks.length ≥ 1` (or honest thin copy).** Add admin/QA criterion: `outfit_looks_missing`.

### P1 — Stop burning the budget upstream

4. Cap planner to **one** live call (or charge retries against a separate pocket, not Stage A).  
5. On normalize hard abort: fail open faster (don’t let stage wall drift to 2× cutoff) and log `normalize_hard_cutoff` into admin criteria.  
6. Router: strip style phrases from `garments[]` before planning (block `"cool style laid back"` as a slot).

### P2 — Observability for the next QA pass

7. Persist `fashion_turn_budget_skip_curation` as a **pipeline_event** (not only stdout) so `/admin/fashion` shows `skip_reason: turn_budget` next to `curation_fallback`.  
8. Admin: show `curation_ms`, `llm_calls.curation`, `looks_delivered`, `turn_remaining_at_curation_gate` on the criteria strip.  
9. Stop surfacing catalog `timing_ms` as if it were turn latency (here 2.5s vs 80s).

---

## 10. How to re-QA after fixes

Same brief / same account, new `trace_id`. Pass only if:

- [ ] `llm_calls` contains `stage=curation` **or** deterministic looks exist with `looks.length ≥ 2`  
- [ ] UI shows **“Three looks”** (or ≥1 named look) for outfit  
- [ ] If turn budget fires, admin shows explicit `skip_reason` **and** looks still present  
- [ ] No garment slot equal to a style phrase  
- [ ] Record: `total_ms`, `normalize_ms`, `hydration_ms`, `curation_ms`, `fallback`, `looks_count`

Compare to old baseline (plan’s 50-run table): old curation p50 ~65–70s with looks; this “optimized” run was 80s turn with **zero** curation and **zero** looks — worse product despite “faster path” rhetoric.

---

## 11. Raw artifacts to attach

- Trace: `0e1c21fa-81c8-486d-82e7-0eabcfd2aff1`  
- Admin: `/admin/fashion/0e1c21fa-81c8-486d-82e7-0eabcfd2aff1`  
- Message: `cms62eg8l000efqeaddwkye1s`  
- Log line: `fashion_turn_budget_skip_curation` (elapsed 38862 / budget 45000 / remaining 6138)  
- Plan JSON + router brief: as pasted in QA criteria (4 slots including `cool style laid back`)  
- Implementation touchpoints:  
  - `src/lib/fashion-memory/pipeline-cutoffs.ts` (`TURN_BUDGET_PHASE1_MS = 45000`)  
  - `src/lib/fashion-memory/catalog-search/search-catalog-for-plan.ts` (`remaining_ms < 8000` → skip)  
  - `src/lib/fashion-memory/curation/fallback.ts` / `provisional-rack.ts` (no outfit `looks`)  
  - `src/components/chat/FashionCurationResults.tsx` (`isOutfit` requires `looks.length > 0`)

---

## 13. Status — v1.1 implemented (2026-07-29)

Code now follows revision 4b of the Find Pipeline plan:

- Pocket budgeting: Stage A earmark (15s) + pre-curation pocket (30s); **skip deleted**
- Degraded ladder: full → half images → text-only → deterministic looks
- Outfit looks always synthesized on provisional/fallback
- Planner: one live LLM call (no second retry)
- Normalize: Promise.race fail-open at hard cutoff
- Style-phrase garments sanitized before planning
- `turn_budget` + `curation` pipeline_events; QA criteria for looks / rung

Re-QA with the same brief and a **new** `trace_id` using the gate in §10.
