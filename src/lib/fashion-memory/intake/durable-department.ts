import {
  coercePersonDepartment,
  departmentFromRelation,
  isGenderedDepartment,
  type PersonDepartment,
} from "../department";
import type { FashionSearchBrief, FashionStatedFacts } from "../router/types";
import type { FashionFactRow, PersonRow } from "../types";
import type { IntakeProfileHints } from "./account-profile-bridge";
import { getGenderPresentation } from "./identity-gate";

/**
 * Durable gendered department for a recipient — facts, then self profile, then
 * strong gift relations. Never invents mens/womens for ambiguous self alone.
 */
export function durableGenderedDepartment(params: {
  facts: FashionFactRow[];
  person: Pick<PersonRow, "relation">;
  profileHints?: IntakeProfileHints | null;
}): PersonDepartment | null {
  const fromFacts = getGenderPresentation(params.facts);
  if (fromFacts && fromFacts !== "mixed") return fromFacts;

  if (params.person.relation === "self") {
    const fromProfile = params.profileHints?.genderPresentation ?? null;
    if (fromProfile && fromProfile !== "mixed") return fromProfile;
  }

  return departmentFromRelation(params.person.relation);
}

/**
 * L2: never search as mixed/wrong gender when we already know mens/womens.
 * Explicit this-turn Mix it (stated_facts.department=mixed) wins.
 */
export function applyDurableDepartmentScope(params: {
  brief: FashionSearchBrief;
  facts: FashionFactRow[];
  person: Pick<PersonRow, "relation">;
  profileHints?: IntakeProfileHints | null;
  stated?: FashionStatedFacts | null;
}): FashionSearchBrief {
  const statedDept = coercePersonDepartment(
    params.stated?.department ?? params.brief.stated_facts?.department,
  );
  if (statedDept === "mixed") {
    return { ...params.brief, department_scope: "mixed" };
  }

  const durable = durableGenderedDepartment({
    facts: params.facts,
    person: params.person,
    profileHints: params.profileHints,
  });
  if (!durable || !isGenderedDepartment(durable)) {
    return params.brief;
  }

  const current = params.brief.department_scope;
  if (
    !current ||
    current === "mixed" ||
    ((current === "mens" || current === "womens") &&
      (durable === "mens" || durable === "womens") &&
      current !== durable)
  ) {
    return { ...params.brief, department_scope: durable };
  }

  return params.brief;
}
