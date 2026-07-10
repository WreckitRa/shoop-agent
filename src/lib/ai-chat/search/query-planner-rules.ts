/**
 * Single source of truth for catalog query rules injected into every LLM planner.
 * Code enforcement lives in query-hygiene.ts (`sanitizePortfolioQuery`).
 */

export const PLANNER_HARD_RULES = `HARD RULES (all archetypes):
- query.text: product noun + attributes ONLY. NEVER include gift, gifts, present, birthday, holiday, for him/her, recipient names, occasion words, or demographic labels (male, female, young adult, teen).
- Put recipient, occasion, budget, and "this is a gift" context ONLY in query.intent — never in query.text.
- NEVER search gift merchandise (gift boxes, baskets, cards, wrap, "gift sets", novelty "perfect gift" items).
- NEVER use vague junk terms alone (accessories, stuff, gear, items, ideas).
- Include exactly ONE row with is_discovery:true (adjacent vocabulary, still a real product).
- Respect gender_scope for self-shopping (e.g. men's running shoes) — never put recipient gender in query.text.
- Match budget signals when provided.`;

export const PLANNER_OUTPUT_FORMAT = `Output ONLY valid JSON, no markdown:
[{"text":"...","intent":"...","is_discovery":false}, ...]`;

export const PLANNER_ARCHETYPE_GUIDANCE = `Archetype guidance:
- specific: 2–3 sharp alternate phrasings of the SAME product need.
- broad: 4–5 queries spanning price tiers, use cases, and adjacent styles.
- gift_vague (no direction_label): 4–6 DIFFERENT product categories the recipient would enjoy owning — each text is a standalone catalog search as if you weren't buying a gift, just picking great products. Vary categories; no duplicate product types.
- gift_directed (direction_label provided): 4–6 DISTINCT product types WITHIN that direction lane only — fan out subtypes inside the theme (e.g. luggage organizers, passport wallets, travel pouches for "Luxury Travel Accessories"). Never cross into other gift categories.`;
