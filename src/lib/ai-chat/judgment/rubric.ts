/**
 * Elicit latent stylist/buyer expertise before sorting — the taste model's job,
 * free from the model's training, not from catalog order or retrieved snippets alone.
 */
export const TIER_JUDGE_EXPERTISE_ELICITATION = `BEFORE you assign tiers, write 4–5 rules a master stylist or buyer would apply to this exact request and this client — drawn from your own category expertise (silhouette, fabric, formality, color, value, occasion), not from candidate list order or implied popularity.

Rules must be concrete and testable (e.g. "Black only — charcoal reads casual", "Slim not skinny — office ease through hip", "Worsted or structured knit — no jersey or fleece").

Then judge every candidate against your rules. Each placement reason MUST cite which rule(s) it satisfies or breaks (e.g. "Rule 1 ✓ slim cut; Rule 3 ✗ unstructured knit"). Tier 1 still requires product features in the reason — rules tell you what to look for; features prove the fit.

Emit buying_rules in the tool output before placements.`;

/**
 * Two-phase judgment: wide triage, then head-to-head among finalists.
 * LLMs score poorly in isolation and excel at forced comparison.
 */
export const TIER_JUDGE_COMPARATIVE_METHOD = `JUDGE COMPARATIVELY, NOT ABSOLUTELY.

PHASE 1 — WIDE TRIAGE: Scan every candidate. advance = could realistically win for this client; drop = wrong category, clear rule-breaker, or no realistic path to tier 1. Do NOT assign final tiers in triage — only advance or drop with a one-line note.

PHASE 2 — DEEP COMPARE (finalists only): Before final tiers, write explicit head-to-head comparisons among finalists competing for the same job (material, formality lane, price band). Format: "A vs B for [this client's situation]: pick one, name the tradeoff." Tier-1 reasons MUST state which comparison the pick won and why for THIS buyer — not isolated praise.`;

/** Constant tier rubric — the judgment task, shared across engine + curator. */
export const TIER_RUBRIC = `Sort each finalist comparatively — never score candidates in isolation.

TIER 1 (Pick + great): wins head-to-head AND passes self-verification checks (color, gender, size-in-stock vs brief from variant data).
  If any required check fails, it is NOT tier 1 — do not emit it as tier 1.

TIER 2 (worth considering): solid finalist that lost a close comparison — say who beat it and the tradeoff.

TIER 3 (other directions): distinct aesthetics/trade-offs among advanced finalists, each labeled by its reason.

Non-finalists were dropped in triage — do not re-list them.

Confidence scales with comparative fit. Speak alternatives, never defects.

Never write generic reasons like "top-ranked match", "best overall match", or "lines up with the product type from your search."`;

export const TIER_JUDGE_TRIAGE_OUTPUT_RULES = `OUTPUT: JSON only, no markdown:
{
  "buying_rules": [
    "Rule 1: <concrete stylist/buyer rule for this request and client>",
    "Rule 2: …"
  ],
  "listing_assessments": [
    { "product_id": "<id>", "listing_quality": "clean"|"suspect"|"junk", "flags": [], "brand_tier": "anchor"|"known"|"unknown" }
  ],
  "triage": [
    { "product_id": "<id from candidates>", "verdict": "advance"|"drop", "note": "<one line>" }
  ]
}
Write 4–5 buying_rules first, then listing_assessments for every candidate, then triage every candidate. Advance 4–8 realistic finalists; drop junk listings and clear rule-breakers.`;

export const LISTING_ASSESSMENT_SCHEMA = {
  type: "object",
  properties: {
    product_id: { type: "string" },
    listing_quality: { type: "string", enum: ["clean", "suspect", "junk"] },
    flags: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "single_size_clearance",
          "sku_title",
          "thin_reviews",
          "dropship_tell",
          "price_anomaly",
          "single_variant",
        ],
      },
    },
    brand_tier: { type: "string", enum: ["anchor", "known", "unknown"] },
  },
  required: ["product_id", "listing_quality", "flags", "brand_tier"],
} as const;

export const TIER_JUDGE_SELF_VERIFICATION = `SELF-VERIFICATION BEFORE EMIT (mandatory for tier 1):
For EVERY tier-1 placement, write a checks row BEFORE placements in the tool output. For each dimension, cite actual variant/title/options data — not vibes.

- color: required color from brief (or "none") vs actual variant/color options; pass only if they match.
- gender: men's/women's scope vs title/options; pass only if aligned (Women's VERITY fails men's brief).
- size_in_stock: requested size vs buyer's matched variant availability; pass only if exact size is in stock.

If any required dimension fails, set pass: false — that product must NOT stay tier 1. Beige when brief requires black, women's when men's, wrong size — all fail explicitly.`;

export const TIER_JUDGE_OUTPUT_RULES = `OUTPUT: JSON only, no markdown:
{
  "head_to_head": [
    {
      "product_ids": ["<id1>", "<id2>"],
      "winner_id": "<id from product_ids>",
      "tradeoff": "<A vs B for this client: pick one, name the tradeoff>"
    }
  ],
  "checks": [
    {
      "product_id": "<tier-1 id>",
      "color": { "required": "black|none", "actual": "<from variant data>", "pass": true|false, "note": "<explicit verification>" },
      "gender": { "required": "mens|womens|none", "actual": "...", "pass": true|false, "note": "..." },
      "size_in_stock": { "required": "40R|none", "actual": "...", "pass": true|false, "note": "..." }
    }
  ],
  "listing_assessments": [
    { "product_id": "<id>", "listing_quality": "clean"|"suspect"|"junk", "flags": ["sku_title"], "brand_tier": "anchor"|"known"|"unknown" }
  ],
  "placements": [
    { "product_id": "<id from finalists>", "tier": 1|2|3, "reason": "<comparison won/lost + features for tier 1>", "confidence": "strong"|"moderate"|"limited" }
  ]
}
Write head_to_head, then checks for every tier-1 pick, then listing_assessments for every finalist, then placements. Tier-1 without a passing checks row will be rejected.`;

/** Brand + listing literacy — activates latent model knowledge via required schema fields. */
export const TIER_JUDGE_LISTING_LITERACY = `LISTING & BRAND LITERACY (mandatory — emit listing_assessments for EVERY candidate):

You know mainstream apparel, footwear, beauty, and home brands from training — use that literacy; do not treat all titles equally.

Review counts statistically:
- 25 reviews at a perfect 5.0 is WEAKER evidence than 4,990 at 4.3 — never trust small-n perfect ratings as "strong."
- Prefer recognizable brands at plausible prices over unknown brands at suspicious prices.

Listing red flags (never tier 1 when present):
- single_size_clearance: size embedded in title ("36 S", "46 L") — reseller clearance, not full stock.
- sku_title: alphanumeric SKU blobs in the title ("70290625M") — dropship/reseller listing hygiene.
- single_variant + sku_title: almost always clearance.
- price_anomaly: price implausibly low for the product type (e.g. $27 "wool blazer").
- dropship_tell: generic/no-brand listing with stock-photo vibes.
- thin_reviews: few reviews with suspiciously perfect rating.

brand_tier:
- anchor: category-trusted names (Calvin Klein, Theory, Nike, CeraVe, etc. for this query).
- known: recognizable but not category anchor.
- unknown: no-brand long-tail — fine as a gem ONLY when features justify it; never fill the whole rack.

listing_quality: clean | suspect | junk — junk listings get drop in triage; suspect never tier 1.

Every rack needs at least one anchor or known brand so unknowns read as finds, not AliExpress.`;
