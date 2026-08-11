import {
  isGenderedDepartment,
  resolveSearchDepartment,
} from "../department";
import type { FashionSearchBrief } from "../router/types";
import type { HydratedCandidate } from "../hydration/types";

/** 0 = known dept signal, 1 = department_unknown (prefer known when gendered). */
export function departmentUnknownRank(
  candidate: Pick<HydratedCandidate, "suspicions">,
): 0 | 1 {
  return candidate.suspicions?.some((s) => s.rule === "department_unknown")
    ? 1
    : 0;
}

/**
 * When shopping a gendered department without vision (fallback / ref order),
 * keep department_unknown after products that already have a dept signal.
 * Score order is preserved within each tier.
 */
export function preferDepartmentKnownWhenGendered<T extends {
  score?: { final?: number } | null;
  suspicions?: HydratedCandidate["suspicions"];
}>(params: {
  brief: FashionSearchBrief;
  candidates: T[];
}): T[] {
  const department = resolveSearchDepartment({
    knowledgeDepartment: params.brief.knowledge_state?.department,
    departmentScope: params.brief.department_scope,
  });
  if (!isGenderedDepartment(department)) {
    return [...params.candidates].sort(
      (a, b) => (b.score?.final ?? 0) - (a.score?.final ?? 0),
    );
  }
  return [...params.candidates].sort((a, b) => {
    const unk = departmentUnknownRank(a) - departmentUnknownRank(b);
    if (unk !== 0) return unk;
    return (b.score?.final ?? 0) - (a.score?.final ?? 0);
  });
}
