import type { PersonRow } from "../types";
import { personShortId } from "./context-format";

export function resolvePersonRef(params: {
  personRef: string;
  personShortIds: Record<string, string>;
  newPersonMap: Map<string, string>;
  people: PersonRow[];
}): string | null {
  const ref = params.personRef.trim();
  if (!ref) return null;

  if (ref.startsWith("new:")) {
    return params.newPersonMap.get(ref) ?? null;
  }

  if (params.personShortIds[ref]) {
    return params.personShortIds[ref]!;
  }

  const byFull = params.people.find((p) => p.id === ref);
  if (byFull) return byFull.id;

  const byShort = params.people.find(
    (p) => personShortId(p.id) === ref.toLowerCase(),
  );
  return byShort?.id ?? null;
}

export function collectDeclaredNewPersonRefs(
  ops: Array<{ op: string; person_ref?: string }>,
): Set<string> {
  const refs = new Set<string>();
  for (const op of ops) {
    if (op.op === "new_person" && op.person_ref?.startsWith("new:")) {
      refs.add(op.person_ref);
    }
  }
  return refs;
}

export function personRefAllowed(
  personRef: string,
  personShortIds: Record<string, string>,
  newPersonMap: Map<string, string>,
  declaredNewRefs: Set<string>,
  people: PersonRow[],
): boolean {
  const ref = personRef.trim();
  if (ref.startsWith("new:")) {
    return newPersonMap.has(ref) || declaredNewRefs.has(ref);
  }
  return resolvePersonRef({ personRef: ref, personShortIds, newPersonMap, people }) != null;
}
