# Fashion enums — single sources of truth

## Person department (brief / facts / intake)

**Type:** `PersonDepartment` in `src/lib/fashion-memory/department.ts`  
**Values:** `mens | womens | boys | girls | baby | mixed`  
**Note:** `unisex` is NOT a person department — coerce legacy → `mixed` via `coercePersonDepartment`.  
`FashionDepartment` is an alias of `PersonDepartment`.

## Product gender target (filters / evidence)

**Type:** `ProductGenderTarget` in `src/lib/fashion-memory/department.ts`  
**Values:** person departments **plus** `unisex` (merchant Unisex rides in Male/Female Target filters).

## budget_interpretation

**Type:** `BudgetInterpretation` in `src/lib/fashion-memory/budget/budgetAllocation.ts`  
**Values:** `per_item_stated | per_item_assumed | set_total_assumed | total_stated`  
Must be set whenever `budget_context.stated` (see `attachBudgetAllocation` + `statedBudgetInterpretation`).

## Veto reasons

**Type:** `CuratorVetoReason` / zod in `src/lib/fashion-memory/curation/types.ts` + `tool-schema.ts`  
**Values:** `wrong_item_type | wrong_department_visual | color_mismatch_visual | visibly_off_brief | quality_visual | duplicate_of_pick | exclusion_violation`

## Badges (user-facing)

**Presentation:** `src/lib/fashion-memory/curation/badge-copy.ts` / `presentation.ts`  
**Render contract mapping:** `src/lib/fashion-memory/curation/build-render-contract.ts`  
Kinds include converted size, size unknown, material suspected, photo color, near-budget lifted, brand unconfirmed.

## fashion_facts.fact_type

**Type:** `FashionFactType` in `src/lib/fashion-memory/types.ts`  
**Values:** `size | fit | no_go | budget_band | body_note | gender_presentation | measurement`

### `measurement` (reserved)

Value shape: `{ "metric": "neck"|"chest"|"waist"|"hips"|"inseam", "value": number, "unit": "cm"|"in" }`  
Supersede key: `(person_id, fact_type=measurement, garment_type=metric)`.

**Reserved for a future size-chart fit layer.** Nothing in search, scoring, or try-on consumes these yet — they are stored from the Tailored avatar path and conversational extraction ("my waist is 84cm") only. Avatar image generators must never receive centimeters; visual silhouette attrs feed the avatar, measurements feed shopping fit later.

Privacy: body data — purged on person hard-delete (`purgePersonMeasurementFacts`); admin/debug shows `measurements on file: N` count only, never values.
