import { departmentFromRelation } from "../department";
import {
  garmentToSizeBucket,
  sizeBucketsForGarments,
} from "./garment-size-fields";
import { getGenderPresentation, hasSizeForBucket } from "./identity-gate";
import type { FashionBriefKnowledgeState, FashionSearchBrief } from "../router/types";
import type { FashionFactRow, PersonRow } from "../types";

export function buildKnowledgeState(params: {
  brief: FashionSearchBrief;
  facts: FashionFactRow[];
  person: PersonRow;
  sizesUnconfirmed: string[];
}): FashionBriefKnowledgeState {
  const department =
    params.brief.department_scope ??
    getGenderPresentation(params.facts) ??
    departmentFromRelation(params.person.relation) ??
    "mixed";

  const buckets = sizeBucketsForGarments(params.brief.garments);
  const sizesConfirmed: string[] = [];
  for (const garment of params.brief.garments) {
    const bucket = garmentToSizeBucket(garment);
    if (!bucket) continue;
    if (hasSizeForBucket(params.facts, bucket) && !sizesConfirmed.includes(garment)) {
      sizesConfirmed.push(garment);
    }
  }

  const unconfirmedSet = new Set(params.sizesUnconfirmed);
  const sizesUnconfirmed = params.brief.garments.filter((g) => unconfirmedSet.has(g));

  return {
    department,
    sizes_confirmed: sizesConfirmed,
    sizes_unconfirmed: sizesUnconfirmed.length
      ? sizesUnconfirmed
      : [...unconfirmedSet],
  };
}
