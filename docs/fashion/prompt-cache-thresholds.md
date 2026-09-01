# Fashion prompt-cache thresholds

Anthropic prompt caching is **silent when under the minimum prefix length**:
`cache_creation_input_tokens` and `cache_read_input_tokens` both return `0`
with no error. Do **not** pad static prompts to chase hits — leave markers
as-is and treat under-threshold stages as **n/a** on `/api/health`.

Source (verified 2026-07-30):
[Prompt caching — Cache limitations](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

## Anthropic minimums (Claude API)

| Model class | Min cacheable tokens |
| --- | ---: |
| Claude Opus 5 / Fable 5 / Mythos 5 | 512 |
| Claude Mythos Preview / Opus 4.7 | 2,048 |
| Claude Opus 4.6 / Opus 4.5 | 4,096 |
| Claude Sonnet 5 / Sonnet 4.6 / Sonnet 4.5 / Opus 4.1 / Opus 4 / Sonnet 4 | 1,024 |
| Claude Haiku 4.5 | **4,096** |
| Claude Haiku 3.5 | 2,048 |

## Shoop fashion stages

Static-prefix sizes measured as `ceil(chars / 3.5)` on the system string only
(tools add more at request time). Configured models as of this doc.

| Stage | Model | Static tokens (approx) | Min | Cacheable? | Why |
| --- | --- | ---: | ---: | --- | --- |
| `router` | Sonnet 5 | ~4,866 | 1,024 | **yes** | `ROUTER_PROMPT_STATIC` clears the floor. Turn 1 writes; turn 2+ should read. |
| `planner` | Haiku 4.5 | ~1,713 | 4,096 | **no** | Under floor. Marker present; zeros expected. **Do not pad.** |
| `normalize_llm` | Haiku 4.5 | ~391 | 4,096 | **no** | Tiny classifier prompt. Zeros = n/a. |
| `extraction` | Haiku 4.5 | ~1,877 | 4,096 | **no** | Under floor. **Do not pad.** |
| `curation` (Stage A) | Sonnet 5 | ~1,502 | 1,024 | **yes** | Skeleton + tools clear Sonnet minimum. |
| `curation_voice` (Stage B) | Haiku 4.5 | ~153 | 4,096 | **no** | Cache explicitly disabled (`disablePromptCache`). Zeros = n/a. |

## `/api/health` `prompt_cache` panel

Each `by_stage` row includes:

- `expected_cacheable` — from the table above
- `hit_rate` — `number` when cacheable; **`null` (= n/a)** when not
- `static_prefix_tokens_approx`, `min_cacheable_tokens`, `why`

Overall hit rate only averages **expected-cacheable** stages so under-threshold
zeros do not look like regressions.

## What not to do

- Do not inflate prompts with filler to clear Haiku's 4,096 floor.
- Do not “fix” planner/normalize/extraction/voice hit rates of 0 — they are
  under threshold by design.
- Do re-measure after a model swap (Haiku ↔ Sonnet changes the floor).
