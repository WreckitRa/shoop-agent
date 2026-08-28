/** Maps brief garment strings → size fact garment_type buckets. */
import { garmentSizingMode } from "../catalog-search/garment-taxonomy";

export type SizeGarmentBucket = "tops" | "bottoms" | "shoes" | "dresses";

export type IntakeSizeField =
  | "size_tops"
  | "size_bottoms"
  | "size_shoes"
  | "size_dresses";

const GARMENT_BUCKET_PATTERNS: Array<{ bucket: SizeGarmentBucket; patterns: RegExp }> =
  [
    {
      bucket: "shoes",
      patterns:
        /\b(shoe|shoes|sneaker|sneakers|boot|boots|trainer|trainers|heel|heels|loafer|loafers|sandal|sandals|flat|flats)\b/i,
    },
    {
      bucket: "dresses",
      patterns: /\b(dress|dresses|gown|gowns|skirt|skirts|jumpsuit|jumpsuits)\b/i,
    },
    {
      bucket: "bottoms",
      patterns:
        /\b(pant|pants|trouser|trousers|chino|chinos|jean|jeans|denim|short|shorts|legging|leggings|suit|suits|tux|tuxedo|belt|belts)\b/i,
    },
    {
      bucket: "tops",
      patterns:
        /\b(shirt|shirts|tee|t-shirt|tshirt|blouse|top|tops|sweater|sweaters|hoodie|hoodies|jumper|knit|knitwear|jacket|jackets|blazer|blazers|coat|coats|outerwear|cardigan|polo|oxford)\b/i,
    },
  ];

const INTAKE_FIELD_BY_BUCKET: Record<SizeGarmentBucket, IntakeSizeField> = {
  tops: "size_tops",
  bottoms: "size_bottoms",
  shoes: "size_shoes",
  dresses: "size_dresses",
};

/**
 * Map garment → size bucket. Accessories with sizing:'none' return null
 * (no check-sizing badge / intake ask). 'simple' families map where real
 * (belts → bottoms/waist; hats skip unless pattern hits).
 */
export function garmentToSizeBucket(garment: string): SizeGarmentBucket | null {
  const key = garment.trim().toLowerCase();
  if (!key) return null;
  const sizing = garmentSizingMode(key);
  if (sizing === "none") return null;
  for (const { bucket, patterns } of GARMENT_BUCKET_PATTERNS) {
    if (patterns.test(key)) return bucket;
  }
  if (sizing === "simple") {
    if (/\b(belt|belts)\b/i.test(key)) return "bottoms";
    return null;
  }
  // Standard apparel with no pattern match — do not invent a tops ask.
  return null;
}

export function sizeBucketsForGarments(garments: string[]): SizeGarmentBucket[] {
  const out = new Set<SizeGarmentBucket>();
  for (const g of garments) {
    const bucket = garmentToSizeBucket(g);
    if (bucket) out.add(bucket);
  }
  return [...out];
}

/** Buckets present on size clarification rows (after normalize). */
export function sizeFamiliesAskedFromQuestions(
  questions: Array<{ gap: string; garment_type?: string | null }>,
): SizeGarmentBucket[] {
  const out: SizeGarmentBucket[] = [];
  const seen = new Set<string>();
  for (const q of questions) {
    if (q.gap !== "size") continue;
    const bucket = q.garment_type?.trim().toLowerCase();
    if (
      bucket !== "tops" &&
      bucket !== "bottoms" &&
      bucket !== "shoes" &&
      bucket !== "dresses"
    ) {
      continue;
    }
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    out.push(bucket);
  }
  return out;
}

export function intakeFieldForBucket(bucket: SizeGarmentBucket): IntakeSizeField {
  return INTAKE_FIELD_BY_BUCKET[bucket];
}

export function bucketForIntakeField(field: IntakeSizeField): SizeGarmentBucket {
  switch (field) {
    case "size_tops":
      return "tops";
    case "size_bottoms":
      return "bottoms";
    case "size_shoes":
      return "shoes";
    case "size_dresses":
      return "dresses";
  }
}

/** Garments that don't clearly map to one department. */
export function isAmbiguousDepartmentGarment(garment: string): boolean {
  const key = garment.trim().toLowerCase();
  return /\b(shirt|shirts|shoe|shoes|sneaker|sneakers|top|tops)\b/i.test(key);
}
