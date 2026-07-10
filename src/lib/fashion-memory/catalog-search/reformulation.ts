import {
  ensureDepartmentQueryPrefix,
  resolveSearchDepartment,
  type FashionDepartment,
} from "../department";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import { safeTrim } from "../safe-trim";
import { extractStyleDescriptors } from "../search-planner/deterministic-builder";

const REFORMULATION_STOP = new Set([
  "slim",
  "minimalist",
  "minimal",
  "classic",
  "formal",
  "premium",
  "tailored",
  "relaxed",
  "business",
  "casual",
  "smart",
]);

/**
 * One thin-slot reformulation pass: broader descriptors, no color nudge.
 * Returns exactly 2 fresh query strings — never repeats prior variants.
 */
export function buildReformulationQueryVariants(params: {
  slot: FashionSearchPlanSlot;
  priorVariants: string[];
  department?: FashionDepartment | string | null;
}): string[] {
  const garment = safeTrim(params.slot.garment).toLowerCase();
  const styleDirection =
    safeTrim(params.slot.style_direction) || garment;
  const department = resolveSearchDepartment({
    knowledgeDepartment: params.department,
  });

  const [desc1, desc2] = extractStyleDescriptors(styleDirection, 2);
  const broad1 = broadenDescriptor(desc1);
  const broad2 = broadenDescriptor(desc2);

  const candidates = [
    `${broad1} ${garment}`.replace(/\s+/g, " ").trim(),
    `${broad2} ${garment}`.replace(/\s+/g, " ").trim(),
    `${garment}`.trim(),
    `classic ${garment}`.trim(),
    `casual ${garment}`.trim(),
  ].map((q) => ensureDepartmentQueryPrefix(q, department));

  const prior = new Set(params.priorVariants.map((v) => v.toLowerCase().trim()));
  const fresh: string[] = [];
  for (const q of candidates) {
    if (!q || prior.has(q.toLowerCase())) continue;
    if (fresh.some((f) => f.toLowerCase() === q.toLowerCase())) continue;
    fresh.push(q);
    if (fresh.length >= 2) break;
  }

  while (fresh.length < 2) {
    const filler = ensureDepartmentQueryPrefix(
      fresh.length === 0
        ? garment
        : fresh.length === 1
          ? `everyday ${garment}`
          : `classic ${garment}`,
      department,
    );
    if (!prior.has(filler.toLowerCase()) && !fresh.includes(filler)) {
      fresh.push(filler);
    } else {
      break;
    }
  }

  return fresh.slice(0, 2);
}

function broadenDescriptor(desc: string): string {
  const t = desc.trim().toLowerCase();
  if (!t || REFORMULATION_STOP.has(t)) return "classic";
  if (t.includes("slim") || t.includes("minimal")) return "classic";
  if (t.includes("formal") || t.includes("business")) return "smart casual";
  return "relaxed";
}
