/** Maps brief garment strings → size fact garment_type buckets. */
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
        /\b(pant|pants|trouser|trousers|chino|chinos|jean|jeans|denim|short|shorts|legging|leggings|suit|suits|tux|tuxedo)\b/i,
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

export function garmentToSizeBucket(garment: string): SizeGarmentBucket | null {
  const key = garment.trim().toLowerCase();
  if (!key) return null;
  for (const { bucket, patterns } of GARMENT_BUCKET_PATTERNS) {
    if (patterns.test(key)) return bucket;
  }
  return "tops";
}

export function sizeBucketsForGarments(garments: string[]): SizeGarmentBucket[] {
  const out = new Set<SizeGarmentBucket>();
  for (const g of garments) {
    const bucket = garmentToSizeBucket(g);
    if (bucket) out.add(bucket);
  }
  return [...out];
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
