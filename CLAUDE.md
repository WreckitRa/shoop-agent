# Shoop pipeline rules (search + curation)

Corrections from production traces become **regression tests** in `src/lib/ai-chat/search/fixtures/` and rules here.

## P0 — Trust / correctness

### Constraint gate (`constraint-gate.ts`)
- After scoring, before verify: drop color/gender violators.
- Before tier judge: same gate — judge never sees violators.
- After tier judge: auto-drop placements that violate must-have constraints.
- **Rule:** Must-have color/gender violation = auto-drop, never tier-2 demotion.

### Size availability (`verify.ts`)
- When `brief.variantConstraints.size` is set, only `exactMatch === true` survives verify.

### Narrator (`engine.ts` → `buildEngineToolResultPayload`)
- Chat model receives only `placements` + `allowed_product_ids`.
- `ruled_out` merges scoring-gate drops, pre/post-judge drops, and judge omissions.
- **Rule:** Narrator must not mention product ids outside `allowed_product_ids`.

### checkedItems (`pick-insight.ts`)
- Only list checks deterministic code ran (`buildHonestCheckedItems`).

### Portfolio gender (`query-hygiene.ts`)
- Self-shopping: every wave gets gender prefix via `ensureGenderPrefixInQuery`.
- Discovery waves: `anchorMustHavesInQuery` — relax nice-to-haves, never must-haves.

## P1 — Quality

### Brief provenance (`brief-provenance.ts`, `archetype.ts`)
- Tag fields: `user_stated` | `persona_inferred` | `profile_default`.
- Downstream uses `brief.provenance` to weight and explain honestly.

### Occasion disambiguation (`brief-occasion.ts`, `brief-enrichment.ts`)
- Resolve ambiguous "work/office" against `workEnvironment` + `lifestyleTags`.
- Record resolution in `brief.provenance.occasionResolution`.

### Constraint scoring (`scoring.ts`)
- `constraintFitPenalty` reduces fit score; must-haves weighted 70% vs nice-to-haves 30% in `attributeFit`.

### Funnel sizing (`constants.ts`, `engine.ts`)
- Verify target: 15–20 (`displayLimit + 6`, cap 20).
- `TIER_JUDGE_CANDIDATE_LIMIT` default 18 (env `TIER_JUDGE_CANDIDATE_LIMIT`).

### Judge rating confidence (`rating-confidence.ts`)
- Clamp LLM `confidence` using Bayesian review-count literacy.

### Expertise retrieval (`expertise-corpus.ts`, `prompt-assembler.ts`)
- Category-keyed precedents in tier judge prompt; wire `contextTag` from engine → `assignSlots` → `runTierJudge`.

### Judge ruled-out (`tier-judge.ts`, `slotting.ts`)
- Track judge omissions as `gate: judge_omission` in `ruled_out`.

### Memory hygiene (`memory-hygiene.ts`, `context.ts`)
- Dedupe canonical memories, expire stale intents, filter empty recipients.
- Scope priority: session > category > global.

## P2 — Observability

### Per-stage latency (`engine.ts`)
- `stageMs`: portfolio, pool, score, verify, slot, total — logged and in audit summary.

### Gate metrics (`pipeline-metrics.ts`)
- `gateMetrics`: constraintGate, verify counts, gift/shipping drops, judge drops — in logs + audit.

## Verdict-first narration (`narrator-contract.ts`)

- Tool result includes `narration_contract`, `curation_stats`, `expertise_principles`, `hero_product_id`.
- Lead with premise-check + **Buy**/**Wait** verdict referencing the buyer — not spec recitation.
- State kill count from `curation_stats` + `rejection_summary` (deterministic ruled-outs).
- **Never** end with a closing narrowing question — decide from profile, escape hatch after.

## Anchor brands (`brand-anchors.ts`)

- Scoring bonus for recognizable anchors; anchor portfolio query; hero slot prefers anchor when tier-equivalent.
- Rack shape: 1–2 anchor brands + room for a gem.

## Expertise corpus (`expertise-corpus.ts`)

- 30+ Flusser-grade principles across fashion, footwear, tech, beauty, home, gifts.
- Wired to tier judge AND narrator via `getExpertisePrinciplesForNarrator`.

## Regression discipline

- Fixture: `src/lib/ai-chat/search/fixtures/blazer-trace-fixture.ts`
- Run: `npm test`
