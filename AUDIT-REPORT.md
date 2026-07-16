# Fashion LLM Prompt & Guard Audit Report

**Date:** 2026-07-15  
**Scope:** Fashion path (`src/lib/fashion-memory/**`, try-on vision touchpoints)  
**Authority:** Cursor CR transcripts (no checked-in design docs under `docs/`). Index: [Router/Extraction/Brand](35404dc1-1ead-4566-a5c0-56862222cdec), [Planner/Normalize](104c251b-4f37-44ed-a1df-bf7392aae988), [Curation](448a2337-825f-42ff-939f-640a90b5fefd), [Blind guards / asymmetry](e9454c9a-61e4-4b74-88b2-02c0fdbb2023), [Accessories/relation](8232bbab-415f-469b-9a54-7bfd9c3a54a2), [Choke-point fixes](01a1cfe5-2e6b-4ab4-93dd-93ba7c38a567).

---

## PART 1 — Inventory

### 1A. LLM touchpoints (fashion path)

| Stage (`llm_calls`) | File | Function | Model (default / env) | Thinking | `tool_choice` | Prompt version | Traced? |
|---------------------|------|----------|------------------------|----------|---------------|----------------|---------|
| `router` (+ `router_retry`, `gate_retry`) | `router/llm-router.ts` | `runFashionRouter` | `FASHION_ROUTER_MODEL` → Haiku | off | `{ type: "any" }` | SHA-256 via `upsertPromptVersion` | ✅ `tracedLLMCall` |
| `router_escalated` (+ `_retry`) | `router/llm-router.ts` | same (escalation) | `FASHION_ROUTER_ESCALATION_MODEL` → Opus; **env off by default** | off | `{ type: "any" }` | same router prompt hash | ✅ |
| `planner` / `planner_retry` | `search-planner/llm-planner.ts` | `runSearchPlanner` | `FASHION_SEARCH_PLANNER_MODEL` → Haiku | off | `{ type: "tool", name: plan_search }` | SHA-256 | ✅ |
| `extraction` | `extraction/llm-extract.ts` | `extractFashionMemoryFromTurn` | `FASHION_EXTRACTOR_MODEL` → Haiku/memory | off | `{ type: "tool", name: record_fashion_ops }` | SHA-256 | ✅ |
| `normalize_llm` | `normalize/llm-classify.ts` | `classifyLabelsWithLlm` | `FASHION_NORMALIZE_MODEL` → Haiku | off | `{ type: "tool", name: classify_labels }` | SHA-256 | ✅ |
| `brand_translate` | `brand/brand-handling.ts` | `translateBrandStyle` | `FASHION_BRAND_TRANSLATE_MODEL` → Haiku | off | `{ type: "tool", name: brand_translate }` | SHA-256 (inline system) | ✅ |
| `curation` (+ corrective retries) | `curation/run-curation.ts` | `callCurationModel` | `FASHION_CURATION_MODEL` → Opus | **adaptive on** | `null` (forced tool forbidden with thinking) | SHA-256 | ✅ **fixed** → `withTracedLlmCall` |
| `avatar_intake` | `tryon/avatar/intake.ts` | `runAvatarIntakeVision` | `OPENAI_VISION_MODEL` | n/a (OpenAI) | n/a | SHA-256 | ✅ **fixed** → `withTracedLlmCall` |
| `tryon_vision_spec` | `tryon/dress/vision-spec.ts` | `analyzeGarmentVisualSpec` | `OPENAI_VISION_MODEL` | n/a | n/a | SHA-256 | ✅ **fixed** → `withTracedLlmCall` (stage newly named) |

**Notes**

- Prompt versioning is content-hash based (`prompt_versions.hash`), not a human `vN` constant (unlike `TRYON_DRESS_PROMPT_VERSION`).
- Image-generation providers (FASHN / OpenAI images edits) are out of chat-prompt stage scope.
- Wrapper choke-point: `withTracedLlmCall` (shared by Anthropic `tracedLLMCall`, curation stream, OpenAI vision).

### 1B. Code-side guards

| Guard | File(s) | Overrides / post-process | Data sources | Info-asymmetry | Choke-point |
|-------|---------|--------------------------|--------------|----------------|-------------|
| Identity gate | `intake/identity-gate.ts` | Builds department+size templates | DB facts / profileHints / brief.department — **not** stated_facts in builders | ⚠️ Blind until filter | Templates → `filterQuestionsSatisfiedByFacts` → sanitize |
| Clarification sanitize | `intake/clarification-sanitize.ts` | Strip meta Qs; roster names off `person_name`; Skip-only chips | Text + roster | ✅ | Shared with LLM + template |
| Clarification dedup | `intake/clarification-dedup.ts` | Drop answered gaps; tripwire re-ask | **stated_facts + DB + ledger** | ✅ doctrine coded in header | Same emit path |
| Dodge counter | `intake/dodge-counter.ts` | Decline gap after 2 unanswered asks | Message metadata; answered gaps suppressed | ✅ | Applied before emit |
| Deterministic clarification template | `router/clarification-defaults.ts` + `post-router.ts` | Default chips; person_name → Skip | Gap type only | n/a | Same sanitize |
| Query validator + deterministic builder | `search-planner/validator.ts`, `query-rules.ts`, `query-builder.ts` | Ban tokens; dept prefix; rebuild variants | Plan/brief | n/a (brief after stated merge) | ✅ both exit `validateSlotQueryVariants` |
| Plan invariants / clamps / fallback | `observability/invariants.ts`, `plan-from-brief.ts`, `fallback-plan.ts` | Clamp slots/options; fallback plan | Brief | n/a | ✅ all via `finalizeResolvedPlan` |
| Budget allocation clamps | `budget/budgetAllocation.ts` (+ tension/lift/raise-ask) | Fractions, pads, interpretation | `budget_context` | n/a | Attached in finalize |
| Curation validator | `curation/validate.ts` | Refs, budget notes, veto rate, thin/degraded narration | Tool output + pools | n/a | Happy path only |
| Fallback curation | `curation/fallback.ts` + `run-curation.ts` | Deterministic picks | Post-veto pools | n/a | ✅ vetoes applied; ❌ **skips `validateCurationOutput`** |
| Badge mapping | `curation/badge-copy.ts`, `presentation.ts`, `build-render-contract.ts` | Whitelist/rename badges | Hydrated candidate | n/a | Code-owned |
| Machinery vocabulary | `curation/narration-sanitize.ts` | Strip funnel/pipeline words | Narration fields | n/a | Happy + fallback |
| Meta-question guard | `clarification-sanitize.ts` (`META_QUESTION_RE`) | Drop bookkeeping questions | Question text | ✅ | Emit path |
| Roster-name-option guard | sanitize + defaults | No roster chips on name Q | Roster names | ✅ | Emit path |
| Escalation triggers | `router/garment-family.ts`, `escalation-metrics.ts` | Re-call Opus router | User text + garments + validation_retry | n/a | Opt-in env |

---

## PART 2 — Prompt reconciliation

Design docs are **not in git**; “latest design” = CR verbatim base **plus** subsequent patch CRs listed in the audit brief.

### Router — **ALIGNED** (no Part-4 restore needed)

| Expected layer | Live status |
|----------------|-------------|
| v2 three-move + off_topic shopping suggestions | ✅ |
| ask_clarification blocking gaps (size + new-person essentials) | ✅ |
| Bundle max 4 + multi-turn + dodge-twice | ✅ |
| stated_facts “knowledge immediately” (MOVE 2 + MOVE 3) | ✅ |
| color_direction + Surprise me | ✅ |
| brand_direction | ✅ |
| machinery / meta ban | ✅ |
| accessories + carry-user’s-word + diversified examples | ✅ |
| name free-text + relation-beats-name | ✅ |
| single-match auto-resolve | ✅ |

**Contradiction check (residue):** `run_intake` ❌ absent from prompt; “system will tell you” ❌ absent; old one-clarification cap ❌ absent from prompt/schema (`questions.max(4)`).

**Intentional divergences vs raw Router v2 paste (reported, not restored):**

1. Format uses per-question `gap` on `questions` (tool schema) instead of top-level `missing` array.
2. `recipient_person_id` + `stated_facts.new_person` registration language replaced “system registers from clarification answers.”
3. Budget `scope: per_item|total` language added (Accessories patch).
4. quick_options **required** on every question (stronger than original “when discrete”).

### Planner — **ALIGNED** (live = base + patches)

Live includes mode/slots, capsule mixability, accessory-tray, palette ladder with `spread`, `budget_fraction`, brand probe, department-first queries, banned tokens incl. full/complete/entire/look/capsule, color limits by `palette_source`. Base CR transcript lacked several of these; patches are present in code.

### Extraction — **ALIGNED** (~0.98 similarity to v2 paste)

Decision procedure (person/item, relation aliases, new_person-first, known/general/purchase triage), short-answer inheritance, `gender_presentation` incl. boys/girls/baby — present. No authorized restore.

### Curation — **MOSTLY ALIGNED**; one authorized fix

| Item | Status |
|------|--------|
| Rule 2 four dirty-data checks | ✅ |
| Mode sections single/outfit/capsule | ✅ |
| Schema `corrected_color` + full veto enum | ✅ in tool-schema; **prompt now mentions `corrected_color`** (Part-4 #2) |
| House rules count | Live has **10** (added `DEGRADED PLAN`) vs design’s 9 — **intentional later patch; reported** |
| Rule 7 capsule set-total / tension | Live richer than Stage-4 paste (capsule budget CRs) — reported |

### Brand translate — **ALIGNED** (short inline system)

Matches Aldo CR: style DNA descriptors, not competitor brands; `sanity_note`; tool `brand_translate`. Cache key by brand+garment family.

### Normalize classify — **ALIGNED**

`CLASSIFY_LABELS_SYSTEM_PROMPT` matches messy-merchant classify_labels spec (color buckets + structured sizes).

### Guard doctrines

| Doctrine | Verdict |
|----------|---------|
| **Information-asymmetry** | Identity-gate **builders** are DB-only (`identity-gate.ts` `buildBlockingClarification`) — mitigated by `filterQuestionsSatisfiedByFacts` before emit (`post-router.ts` ~1174–1213). Dedup file documents the rule. |
| **Choke-point** | Fallback plan ✅; query builder ✅; template clarification ✅; curation vetoes ✅. **Violation:** fallback curation does **not** re-enter `validateCurationOutput` (`run-curation.ts` ~755–786) despite `fallback.ts` comment. |

---

## PART 3 — Cross-prompt contradiction scan

| Check | Result |
|-------|--------|
| Question policy (one-cap vs bundle-4 vs dodge-2) | **One regime:** max 4 + multi-turn + dodge-2. UX copy “I only ask once” is framing only. |
| Banned tokens code ↔ prompt ↔ department-required | **In sync.** `BANNED_QUERY_PATTERNS` includes full/complete/entire/whole/look/capsule/outfit/head-to-toe; department words required, not banned. |
| `budget_interpretation` | Enum shared: `per_item_stated \| per_item_assumed \| set_total_assumed \| total_stated`. Router emits `scope` not interpretation. **Fixed:** validator `budgetNoteRequired` now includes `total_stated`. Outfit+total may still leave interpretation **unset** (allocation code). |
| Veto enum | **Identical** across types / zod / JSON schema / events. Prompt describes in prose (soft). |
| Badge enum | Presentation kinds renamed in render-contract (`converted_size`→`size_converted`, etc.). Prompt honesty ≠ badge enum — OK. |
| Department enum | **Drift:** brief/`FashionDepartment` includes `unisex`; stated_facts / gender_presentation / extraction omit it. |
| Escalation triggers | Reasons `accessories_coerced`, `unknown_family_common`, `validation_retry` exist and fire when env enabled. |

---

## PART 4 — Authorized fixes applied

| # | Fix | Change |
|---|-----|--------|
| 1 | Verbatim prompt drift | No wholesale restores (live already = latest patched authority). |
| 2 | Enum/list drift | `budgetNoteRequired` + `total_stated`; curation rule 2 documents `corrected_color`. Prompt hash auto-bumps via content SHA. |
| 3 | Dead code | Deleted unreferenced deprecated `loadPriorIntakeTurn` + `applyIntakeReplyFromMessage`. **Kept** `run_intake` read-compat in `loadPriorClarificationTurn` (old DB rows). |
| 4 | Untraced LLM | Introduced `withTracedLlmCall`; routed curation stream, `avatar_intake`, `tryon_vision_spec` through it. `tracedLLMCall` now delegates to the same choke-point. |

---

## PART 5 — Deployed vs merged (debug panel “not instrumented”)

Source: `src/lib/qa/debug-criteria.ts` + `AgentDebugPanel.tsx` (chat does **not** pass `pipelineEvents`).

| Panel field | Classification | Evidence |
|-------------|----------------|----------|
| `brief.stated_facts` | **Implemented-but-broken (partial)** | Emit in `run-fashion-chat-stream` router metadata; panel reads last catalog-search assistant message — may miss clarify-turn facts. |
| Query / Lane B | **Implemented when meta present** | `query_variants_used[].lane` in catalog meta; labeled `query lane N` not “Lane B”. |
| `guard bounds` | **Not deployed** | Slot has `guard_band_count` / `market_prices` live, but stripped from `fashionCatalogSearchToMetadata` / chat Pick type — debug always empty. |
| `hydration_summary` | **Implemented-but-broken** | Emit `hydration` with `killed` (`orchestrator.ts`); reader expects `deaths_by_cause`. Chat never passes `pipelineEvents`. |
| `curation_vetoes` | **Partial / broken wiring** | Events `curator_veto` + curation debug exist; chat can use `fashionCurationRuns`. Admin builder hardcodes `curationDebug: null`. |
| `signals_written` | **Never-implemented** | Reader waits for `style_signal_written`; **no emitter** in `src/`. |

---

## Ranked fix backlog (not authorized in Part 4)

1. **P0** — Fallback curation: run `validateCurationOutput` (or shared subset) after `buildDeterministicFallback`.
2. **P0** — Debug: plumb `pipelineEvents` into chat `AgentDebugPanel` QA criteria.
3. **P0** — Debug: align hydration payload (`killed` ↔ `deaths_by_cause`) or reader keys.
4. **P1** — Debug: include `guard_band_count` / `market_prices` in chat catalog metadata.
5. **P1** — Emit `style_signal_written` (or drop panel row).
6. **P1** — Outfit + `scope:"total"` → set `budget_interpretation: total_stated` (or document intentional undefined).
7. **P1** — Department `unisex` reconcile across stated_facts / extraction / presentation.
8. **P2** — Identity-gate builders accept stated_facts directly (stop relying solely on downstream filter).
9. **P2** — Remove or feature-flag `run_intake` legacy metadata branch once old conversations expire.
10. **P2** — Check in authoritative prompt/doctrine markdown under `docs/fashion/` to stop transcript archaeology.
11. **P2** — Admin `buildQaDebugCriteriaFromAdminDetail` pass real `curationDebug`.
12. **P3** — Optional: extract brand_translate system string to `prompt.ts` for parity with other stages.

---

## Test results

### Per-stage fashion suite (tsx --test)

**314 passed / 0 failed** (174 suites), ~2.6s — covering fixtures (Joe, blind guards, accessories, pipeline, person-identity, department, relevance, attire), intake, router, planner, budget, curation, hard-drops, scoring, hydration, product-card, QA, try-on.

### E2E mocked (`npm run test:e2e`)

**10/10 scenarios passed** (1 run each):

- e2e_joe_first_message
- e2e_cyprus_cold_profile
- e2e_capsule_300
- e2e_aldo_translated
- e2e_tight_budget_honest
- e2e_womens_leak_blocked
- e2e_interaction_chain
- e2e_curation_fallback_recurate
- e2e_memory_loop
- e2e_full_sse_turn

Report artifact: `e2e-report.json`

### Acceptance checklist

- [x] Complete inventories; untraced fashion LLM calls routed through `withTracedLlmCall`.
- [x] Every prompt matches latest design **or** divergences listed; authorized drift fixed (corrected_color prompt note; budgetNote `total_stated`).
- [x] Guards classified against both doctrines with line anchors.
- [x] Contradiction scan itemized (department `unisex`, outfit total interpretation unset).
- [x] Deployed-vs-merged truth table for panel “not instrumented” fields.
- [x] `AUDIT-REPORT.md` produced; stage + e2e mocked suites green.
