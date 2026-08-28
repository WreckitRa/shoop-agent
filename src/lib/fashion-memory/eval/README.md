# Fashion appointment eval

Harness for simulated shoppers × deterministic checks × **Opus judge**.

## Judge policy

- **Opus grades everything.** Sonnet retired (compresses the top of the scale).
- **Tone / voice iterations** (router `reply` / `known_summary` / `pull_line`
  wording only): `--subset 30`, Opus on that subset.
- **Bar claims** (truth_match, not_interrogated ≥4, overall targets, etc.):
  **full seed (68)**, Opus.
- No Sonnet+Opus blend; no bottom-15 tiering.

Run the **full seed** for:

- any change to gates, tool schema, slots, depth, planner, curation, or shopper
- any run used to claim a bar
- if unsure — run full and say so

```bash
# Structural personas for a seed (no LLM polish unless EVAL_PERSONA_LLM=1)
npm run eval:appointments -- --seed 1 --generate-only

# Router stage — golden only (includes two-visit `golden-visit-2`)
npm run eval:appointments -- --seed 1 --golden-only --stage router

# Two-visit memory golden only (smoke, then Opus-grade the same run)
EVAL_PERSONA_IDS=golden-visit-2 npm run eval:appointments -- --seed 1 --golden-only --stage router --skip-judge --label visit2-proof
EVAL_PERSONA_IDS=golden-visit-2 npm run eval:appointments -- --seed 1 --golden-only --stage router --resume <run-id>

`fewer_consults` counts consultative questions excluding `preference_anchor`
(mandatory recognition gesture, not a consultation). Passes when visit 2
has **0** consults (anchor-only is the ideal). `visit2_anchor_only` requires
that visit 2 ask nothing except the anchor. Purchase-history families skip
the unnamed-garment gate.

# Full matrix (8 golden + 60 sampled) — router only
npm run eval:appointments -- --seed 1 --stage router --parallelism 6

# Live retrieval S0/S1 pair (8 golden + 8 known-client)
EVAL_ORG_SPEND_ALLOW_RUN=1 npm run eval:appointments -- \
  --seed 1 --stage full --skip-judge --weights v3-brand --label v3-brand --max-usd 20
EVAL_ORG_SPEND_ALLOW_RUN=1 npm run eval:appointments -- \
  --seed 1 --stage full --skip-judge --weights v4-taste --label v4-taste --max-usd 20 \
  --compare-with src/lib/fashion-memory/eval/runs/<v3-run-dir>

# Tone iteration (Opus on stratified 30)
EVAL_ORG_SPEND_ALLOW_RUN=1 npm run eval:appointments -- \
  --seed 1 --stage router --skip-generate --subset 30 --parallelism 4

# Calibration pack: Opus ↔ provisional reader (see calibration/SONNET-OFFSET.md)
# Human overalls live in calibration/cal-*.json
```

Flags: `--skip-judge`, `--skip-generate`, `--limit N`, `--parallelism N`,
`--subset N`, `--max-usd N`, `--resume <run-id>`, `--weights v3-brand|v4-taste`,
`--known-client-only`, `--with-sampled`, `--compare-with <run-dir>`, `--label`.

Org spend: every run prints monthly limit + headroom. Set
`EVAL_ORG_MONTHLY_SPEND_LIMIT_USD` after raising Console Billing, or
`EVAL_ORG_SPEND_ALLOW_RUN=1` to unlock.

Artifacts land in `runs/<seed>-<timestamp>/` (`report.md`, `summary.json`, per-persona JSON).
Changelog: `CHANGELOG-eval.md`.
