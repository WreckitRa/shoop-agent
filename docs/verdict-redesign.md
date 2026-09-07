# Verdict funnel redesign (locked)

Build spec. Current-state dump: `docs/verdict-funnel.md`.

## Ship order

1. Quiz — why-here, honesty 3 chips (`1`/`3`/`5`), geo country confirm.
2. Face facts — Luna closed-choice (later). Skip-scan still runs verdict with unconfirmed facts.
3. Verdict — Sol sees the photo, `{ reading, contract }`, medium reasoning, code validation.
4. Card — headline / who / shift / 3 rules / colours / looks / full_profile. No donut.
5. Yes/no tees — template recolour, not catalog.
6. Looks — taxonomy GID + colour buckets + judge + sequential FASHN v1.6 + render check.
7. Eval fixture.

## Shipped

- Quiz: `dressingFor` why-here chips, honesty 1/3/5, geo country confirm.
- Verdict: Sol sees the photo, `{ reading, contract }`, medium reasoning, code validation + one repair. Runs without photo / without scan-check.
- Card: headline, who, shift, 3 rules, colours, looks, full profile. No donut / readiness / based_on.

Still later: Luna face facts (replace Terra), template yes/no tees, taxonomy+judge+sequential FASHN looks, eval fixture.


## Locked decisions

- Twin: face-to-model 2:3 1k; body from quiz attrs; coverage gate before dressing legs.
- Catalog: same `search()`; taxonomy GIDs; never Color/Size on `filters.attributes`.
- FASHN on this path: `tryon-v1.6`, sequential top-first, collage off.
- Colour families = existing `COLOR_BUCKETS` (not `gray`/`cream`/`multicolor` as families). Cream is a shade → `white`.
- Honesty chips store `"1"` / `"3"` / `"5"`. `"3"` is balanced, not a no-op.
- `dressingFor` is a new why-here field (not dating chips). Country is geo confirm, not a new step.
- Donut off the card; `styleMix` still stored.

## Contract

Enums and validation live in `src/lib/photo-analysis/style-contract.ts`.
Prompts: `src/lib/photo-analysis/fitting-verdict-prompt.ts`.
Brief: `src/lib/photo-analysis/fitting-verdict-brief.ts`.
