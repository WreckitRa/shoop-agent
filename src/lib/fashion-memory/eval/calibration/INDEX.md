# Judge calibration pack

Sources: seed 1 + seed 2 judged runs. Span: judge overall **2.0–4.5**.

**Judge = Opus only** (Sonnet retired). See `SONNET-OFFSET.md` for
Opus↔provisional-reader agreement.

**cal-04 excluded (parse)** — zero-question / placeholder transcript; not used for agreement.

Provisional reader overalls are filled (`human_overall`); dim-level human
pass still open if we want ≥80% dim agreement before further voice tuning.

| id | judge overall | cell | persona | run | file |
|---|---:|---|---|---|---|
| cal-01 | 2.30 | outfit×complete | 77d834dbfd1a | 2-2026-08-27T08-… | cal-01-77d834dbfd1a.json |
| cal-02 | 2.40 | capsule×partial | 8b7134c4c782 | 2-2026-08-27T08-… | cal-02-8b7134c4c782.json |
| cal-03 | 2.90 | single_item×complete | c6b2f1f55f9b | 1-2026-08-26T09-… | cal-03-c6b2f1f55f9b.json |
| cal-04 | 3.00 | single_item×complete | 03aaaf481cdb | 1-2026-08-26T09-… | cal-04-03aaaf481cdb.json |
| cal-05 | 3.20 | capsule×partial | b91c8efa8d68 | 1-2026-08-26T09-… | cal-05-b91c8efa8d68.json |
| cal-06 | 3.50 | capsule×complete | 170eab28707d | 2-2026-08-27T08-… | cal-06-170eab28707d.json |
| cal-07 | 3.80 | outfit×vague | 346d2347e233 | 1-2026-08-26T09-… | cal-07-346d2347e233.json |
| cal-08 | 4.10 | outfit×vague | 25c71b8f28ea | 1-2026-08-26T09-… | cal-08-25c71b8f28ea.json |
| cal-09 | 4.40 | capsule×partial | 36b15afdbb3e | 1-2026-08-26T09-… | cal-09-36b15afdbb3e.json |
| cal-10 | 4.50 | outfit×complete | b255b8ce6c37 | 1-2026-08-26T09-… | cal-10-b255b8ce6c37.json |

## Per-dimension judge scores

| id | rec | ask | not_int | no_silent | acc | voice | proceed |
|---|---:|---:|---:|---:|---:|---:|---:|
| cal-01 | 2 | 3 | 4 | 2 | 3 | 1 | 2 |
| cal-02 | 2 | 3 | 1 | 4 | 3 | 2 | 2 |
| cal-03 | 3 | 4 | 5 | 2 | 4 | 1 | 3 |
| cal-04 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| cal-05 | 2 | 3 | 3 | 4 | 4 | 3 | 4 |
| cal-06 | 3 | 4 | 5 | 4 | 4 | 2 | 4 |
| cal-07 | 4 | 5 | 4 | 4 | 3 | 4 | 4 |
| cal-08 | 4 | 5 | 5 | 4 | 3 | 4 | 5 |
| cal-09 | 4 | 3 | 5 | 4 | 5 | 4 | 5 |
| cal-10 | 4 | 5 | 5 | 4 | 5 | 3 | 5 |
