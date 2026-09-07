/**
 * Sol fitting verdict: reading first, then a Style Contract.
 * Replaces the 9-root shopping-engine schema for new writes.
 */

import {
  BOTTOM_FITS,
  COLOR_FAMILIES,
  GARMENT_TYPES,
  NECKLINES,
  PATTERN_SCALES,
  RISES,
  SLOTS,
  STRUCTURES,
  TOP_FITS,
} from "./style-contract";

export const FITTING_VERDICT_SCHEMA_NAME = "fitting_verdict";
export const FITTING_VERDICT_SCHEMA_DESCRIPTION =
  "A personal fitting: the words they read, and a contract that pulls real products.";

const familyEnum = { type: "string", enum: [...COLOR_FAMILIES] } as const;
const garmentEnum = { type: "string", enum: [...GARMENT_TYPES] } as const;
const slotEnum = { type: "string", enum: [...SLOTS] } as const;
const neckEnum = { type: "string", enum: [...NECKLINES] } as const;
const topFitEnum = { type: "string", enum: [...TOP_FITS] } as const;
const bottomFitEnum = { type: "string", enum: [...BOTTOM_FITS] } as const;

/** Hex is derived in code from family+shade. Asking Sol for it loops until the token cap. */
const swatchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["family", "shade"],
  properties: {
    family: familyEnum,
    shade: { type: "string" },
  },
} as const;

const avoidSchema = {
  type: "object",
  additionalProperties: false,
  required: ["family", "shade", "why", "fix"],
  properties: {
    family: familyEnum,
    shade: { type: "string" },
    why: { type: "string" },
    fix: { type: "string" },
  },
} as const;

const pieceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "slot",
    "garment_type",
    "color_family",
    "shade",
    "fallback_family",
    "fit",
    "neckline",
    "must_have",
    "must_not",
  ],
  properties: {
    slot: slotEnum,
    garment_type: garmentEnum,
    color_family: familyEnum,
    shade: { type: "string" },
    fallback_family: { anyOf: [familyEnum, { type: "null" }] },
    fit: {
      anyOf: [
        { type: "string", enum: [...TOP_FITS, ...BOTTOM_FITS] },
        { type: "null" },
      ],
    },
    neckline: { anyOf: [neckEnum, { type: "null" }] },
    must_have: {
      type: "array",
      items: { type: "string" },
      maxItems: 3,
    },
    must_not: {
      type: "array",
      items: { type: "string" },
      maxItems: 12,
    },
  },
} as const;

const lookSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "occasion_from", "pieces"],
  properties: {
    name: { type: "string" },
    occasion_from: { type: "string" },
    pieces: {
      type: "array",
      items: pieceSchema,
      minItems: 2,
      maxItems: 4,
    },
  },
} as const;

export const FITTING_VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reading", "contract"],
  properties: {
    reading: {
      type: "object",
      additionalProperties: false,
      required: [
        "headline",
        "who_you_are",
        "the_shift",
        "rules",
        "this_week",
        "full_profile",
      ],
      properties: {
        headline: { type: "string" },
        who_you_are: { type: "string" },
        the_shift: { type: "string" },
        rules: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["rule", "why"],
            properties: {
              rule: { type: "string" },
              why: { type: "string" },
            },
          },
        },
        this_week: { type: "string" },
        full_profile: { type: "string" },
      },
    },
    contract: {
      type: "object",
      additionalProperties: false,
      required: [
        "palette",
        "silhouette",
        "necklines",
        "fabrics",
        "patterns",
        "vetoes",
        "looks",
      ],
      properties: {
        palette: {
          type: "object",
          additionalProperties: false,
          required: [
            "near_face",
            "core",
            "neutrals",
            "accents",
            "avoid_near_face",
          ],
          properties: {
            near_face: {
              type: "array",
              items: swatchSchema,
              maxItems: 4,
            },
            core: { type: "array", items: swatchSchema, maxItems: 3 },
            neutrals: { type: "array", items: swatchSchema, maxItems: 3 },
            accents: { type: "array", items: swatchSchema, maxItems: 2 },
            avoid_near_face: {
              type: "array",
              items: avoidSchema,
              maxItems: 2,
            },
          },
        },
        silhouette: {
          type: "object",
          additionalProperties: false,
          required: [
            "top_fit",
            "bottom_fit",
            "rise",
            "structure",
            "length_notes",
          ],
          properties: {
            top_fit: topFitEnum,
            bottom_fit: bottomFitEnum,
            rise: { type: "string", enum: [...RISES] },
            structure: { type: "string", enum: [...STRUCTURES] },
            length_notes: {
              type: "array",
              items: { type: "string" },
              maxItems: 4,
            },
          },
        },
        necklines: {
          type: "object",
          additionalProperties: false,
          required: ["yes", "no"],
          properties: {
            yes: { type: "array", items: neckEnum, maxItems: 8 },
            no: { type: "array", items: neckEnum, maxItems: 8 },
          },
        },
        fabrics: {
          type: "object",
          additionalProperties: false,
          required: ["yes", "no"],
          properties: {
            yes: {
              type: "array",
              items: { type: "string" },
              maxItems: 8,
            },
            no: {
              type: "array",
              items: { type: "string" },
              maxItems: 8,
            },
          },
        },
        patterns: {
          type: "object",
          additionalProperties: false,
          required: ["scale", "yes", "no"],
          properties: {
            scale: { type: "string", enum: [...PATTERN_SCALES] },
            yes: {
              type: "array",
              items: { type: "string" },
              maxItems: 8,
            },
            no: {
              type: "array",
              items: { type: "string" },
              maxItems: 8,
            },
          },
        },
        vetoes: {
          type: "array",
          items: { type: "string" },
          maxItems: 12,
        },
        looks: {
          type: "array",
          items: lookSchema,
          minItems: 4,
          maxItems: 6,
        },
      },
    },
  },
} as const;

export const FITTING_VERDICT_INSTRUCTIONS = `You are Shoop's stylist. You're giving one person the first honest, useful read of their style they've ever had — what a great stylist says in the first ten minutes of a fitting after looking at you and listening to you: "here's what's going on, here's what we're doing."

You get their photo (when there is one), the face facts they confirmed, and a brief written from their answers. Write for them, to them, about them.

HOW TO WRITE
- A sharp friend who does this for a living. Short sentences. Concrete nouns. No magazine adjectives, no textbook. If a sentence would be true of anyone, cut it.
- Everything traces to what you saw or what they said. Reference it naturally ("that beard", "your Sunday brunches", "the jeans you said you hate") — never as citations, never "because you told me".
- Lead with what's already good. Then name the one thing actually costing them. Then the direction. Don't hedge; if you're not sure, don't say it.
- Reasons are visible effects ("navy up top pulls the eye to your face", "a straight leg squares off your shoulders"), never body rules. Never call a feature a problem or tell them to hide anything.
- Tone dial from the brief: gentle | straight | blunt. Blunt means you say the thing they already suspect, kindly and once.
- Don't use: elevated, curated, aesthetic, effortless, timeless, capsule, foundation, "invest in quality basics". Don't lead with a style-tribe label; describe it, then name it if a name helps.
- Vetoes and comfort needs are law. Nothing on the veto list, not even "a better version".
- You style menswear, womenswear, and both. Match the clothing type in the brief. Never assume menswear.

WHAT YOU PRODUCE (one JSON object)
1. reading — the words they see. Write this first.
2. contract — the same advice as fixed-vocabulary choices. It pulls real products and dresses their avatar, so it must agree with the reading exactly: every colour you name in the reading is in the palette; every piece obeys silhouette, neckline, fabric and veto rules; nothing in avoid_near_face appears above the waist in any look.

COLOUR
- Color families must be from the vocabulary (black, white, grey, beige, brown, navy, blue, green, olive, red, burgundy, pink, purple, orange, yellow, gold, silver, denim, multi, print). Cream is a shade of white. Camel is beige or brown. Olive and burgundy are their own families.
- near_face = what should touch their face: collars, tees, knits. Derive from confirmed depth, undertone, contrast, hair, eyes. The photo is your reference; the confirmed facts are the truth if they differ.
- avoid_near_face: exactly two families when there is a photo. Each gets a one-line visible-effect reason and a fix (wear it below the waist / the version that works). Pick families that will look visibly worse, not merely less ideal.
- Put the real shade in shade. Do not emit hex — code fills the swatch from family and shade.

LOOKS
- 4 to 6 looks, for the week they described; name the source answer for each. Climate from the brief — no wool coat in a hot-humid week.
- Each look: 2–4 pieces. One top OR one one_piece, one bottom unless one_piece, shoes, optional outerwear. Never two tops. No accessories.
- Each piece: garment_type from the vocabulary, colour family from THEIR palette, fit from your silhouette rules, neckline from necklines.yes when it's a top, must_not carrying every veto term (crop, heels, skinny, logo, neon — whatever they locked).
- Across the looks: at least three different near-face colours on top; never the same top type + colour twice.
- If there is no photo, skip near_face and avoid_near_face (empty arrays), build the palette from what they told you, and say in the reading that a photo unlocks colours.

VOICE EXAMPLE (voice only — never reuse the content)
headline: "Dark, sharp, a little undone"
who_you_are: "High contrast — near-black hair, light skin, dark eyes — which is why the deep, clean colours you already reach for on Fridays are the ones that work. The beard is doing real work for your jaw; keep it at that length."
the_shift: "What's costing you is the faded, oversized weekend stuff drifting into work — you called it sloppy on Zoom, and that's what it is. We keep the ease you like and put an edge on it: darker, straighter, one size closer to you."
rules[0]: { rule: "Dark and plain next to your face.", why: "Your contrast does the work; a print fights it." }
`;

export const FITTING_VERDICT_REPAIR_INSTRUCTIONS = `You already wrote a fitting. Code found contract violations listed in the user message.

Fix the contract so every violation is gone. Keep the reading unless a violation is in the reading (then edit only the offending sentences). Do not invent a new person. Do not drop vetoes. Do not emit hex. Return the full { reading, contract } object.
`;
