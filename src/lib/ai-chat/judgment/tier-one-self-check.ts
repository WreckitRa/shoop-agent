/**
 * Tier-1 self-verification before emit — explicit color / gender / size-in-stock
 * checks against brief + variant data. LLM writes checks; code enforces.
 */
import {
  colorConstraintViolation,
  genderConstraintViolation,
  mustHaveColorViolation,
  requiredColors,
} from "../search/constraint-gate";
import type { SearchBrief } from "../search/types";
import type { VerifiedCandidate } from "../search/verify";
import type { TierPlacement } from "./tier-judge";

export type SelfCheckDrop = {
  productId: string;
  title: string;
  reason: string;
};

export type SelfCheckDimension = {
  required: string;
  actual: string;
  pass: boolean;
  note: string;
};

export type TierOneSelfCheck = {
  productId: string;
  color: SelfCheckDimension;
  gender: SelfCheckDimension;
  sizeInStock: SelfCheckDimension;
};

function resolveCanonicalProductId(
  rawId: string,
  validIds: Set<string>,
): string | null {
  const trimmed = rawId.trim();
  if (!trimmed) return null;
  if (validIds.has(trimmed)) return trimmed;

  for (const id of validIds) {
    if (id.endsWith(trimmed) || trimmed.endsWith(id)) return id;
  }

  const numeric = trimmed.match(/(\d+)\s*$/)?.[1];
  if (numeric) {
    for (const id of validIds) {
      if (id.endsWith(`/${numeric}`) || id.endsWith(numeric)) return id;
    }
  }

  return null;
}

function parseDimension(raw: unknown): SelfCheckDimension | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const required = String(r.required ?? "none").trim().slice(0, 80) || "none";
  const actual = String(r.actual ?? "").trim().slice(0, 120);
  const note = String(r.note ?? "").trim().slice(0, 200);
  if (!actual || !note) return null;
  const pass = r.pass === true;
  return { required, actual, pass, note };
}

export function parseTierOneSelfChecks(
  value: unknown,
  validIds: Set<string>,
): TierOneSelfCheck[] {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  const raw = root.checks ?? root.self_checks;
  if (!Array.isArray(raw)) return [];

  const out: TierOneSelfCheck[] = [];
  const seen = new Set<string>();

  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const productId = resolveCanonicalProductId(
      String(r.product_id ?? r.productId ?? ""),
      validIds,
    );
    if (!productId || seen.has(productId)) continue;

    const color = parseDimension(r.color);
    const gender = parseDimension(r.gender);
    const sizeInStock = parseDimension(
      r.size_in_stock ?? r.sizeInStock ?? r.size,
    );
    if (!color || !gender || !sizeInStock) continue;

    seen.add(productId);
    out.push({ productId, color, gender, sizeInStock });
  }

  return out;
}

function candidateText(vc: VerifiedCandidate): string {
  const detail = vc.judgeDetail ?? vc.detail;
  const parts: string[] = [detail.title ?? ""];
  for (const opt of detail.options ?? []) {
    parts.push(opt.name);
    for (const v of opt.values ?? []) parts.push(v.label);
  }
  for (const ro of vc.resolvedOptions ?? []) {
    parts.push(`${ro.name}: ${ro.label}`);
  }
  return parts.join(" ").toLowerCase();
}

export type DeterministicSelfCheck = {
  colorRequired: boolean;
  genderRequired: boolean;
  sizeRequired: boolean;
  colorPass: boolean | null;
  genderPass: boolean | null;
  sizePass: boolean | null;
};

export function deterministicSelfCheck(
  vc: VerifiedCandidate,
  brief: SearchBrief,
): DeterministicSelfCheck {
  const text = candidateText(vc);
  const colorRequired = requiredColors(brief).length > 0;
  const genderRequired =
    brief.recipient.kind === "self" &&
    (brief.genderScope === "mens" || brief.genderScope === "womens");
  const sizeRequired = Boolean(brief.variantConstraints?.size?.trim());

  const colorPass = colorRequired
    ? !colorConstraintViolation(brief, text) && !mustHaveColorViolation(brief, text)
    : null;
  const genderPass = genderRequired
    ? !genderConstraintViolation(brief, text)
    : null;
  const sizePass = sizeRequired
    ? vc.exactMatch === true &&
      vc.availability?.status !== "out_of_stock" &&
      vc.availability?.preferredMatched !== false
    : null;

  return {
    colorRequired,
    genderRequired,
    sizeRequired,
    colorPass,
    genderPass,
    sizePass,
  };
}

function dimensionPasses(
  dim: SelfCheckDimension,
  required: boolean,
  deterministic: boolean | null,
): boolean {
  if (!required) return true;
  if (!dim.pass) return false;
  if (deterministic === false) return false;
  return true;
}

function selfCheckPasses(
  check: TierOneSelfCheck,
  det: DeterministicSelfCheck,
): boolean {
  return (
    dimensionPasses(check.color, det.colorRequired, det.colorPass) &&
    dimensionPasses(check.gender, det.genderRequired, det.genderPass) &&
    dimensionPasses(check.sizeInStock, det.sizeRequired, det.sizePass)
  );
}

function failureReason(
  check: TierOneSelfCheck,
  det: DeterministicSelfCheck,
): string {
  const parts: string[] = [];
  if (det.colorRequired && !dimensionPasses(check.color, true, det.colorPass)) {
    parts.push(`color (${check.color.note || check.color.actual})`);
  }
  if (det.genderRequired && !dimensionPasses(check.gender, true, det.genderPass)) {
    parts.push(`gender (${check.gender.note || check.gender.actual})`);
  }
  if (det.sizeRequired && !dimensionPasses(check.sizeInStock, true, det.sizePass)) {
    parts.push(`size (${check.sizeInStock.note || check.sizeInStock.actual})`);
  }
  return parts.join("; ") || "self-check failed";
}

/** Drop or demote tier-1 picks that fail explicit + deterministic verification. */
export function enforceTierOneSelfChecks(params: {
  placements: TierPlacement[];
  checks: TierOneSelfCheck[];
  verified: VerifiedCandidate[];
  brief: SearchBrief;
}): {
  placements: TierPlacement[];
  drops: SelfCheckDrop[];
} {
  const byId = new Map(params.verified.map((v) => [v.detail.id, v]));
  const checksById = new Map(params.checks.map((c) => [c.productId, c]));
  const drops: SelfCheckDrop[] = [];
  const out: TierPlacement[] = [];

  for (const placement of params.placements) {
    if (placement.tier !== 1) {
      out.push(placement);
      continue;
    }

    const vc = byId.get(placement.productId);
    const check = checksById.get(placement.productId);
    if (!vc || !check) {
      drops.push({
        productId: placement.productId,
        title: vc?.detail.title ?? "",
        reason: "Tier 1 rejected — missing self-verification checks",
      });
      out.push({
        ...placement,
        tier: 2,
        confidence: "limited",
        reason: `${placement.reason} — tier 1 unverified (missing checks)`,
      });
      continue;
    }

    const det = deterministicSelfCheck(vc, params.brief);
    if (!selfCheckPasses(check, det)) {
      drops.push({
        productId: placement.productId,
        title: vc.detail.title ?? "",
        reason: `Self-check failed: ${failureReason(check, det)}`,
      });
      out.push({
        ...placement,
        tier: 2,
        confidence: "limited",
        reason: `${placement.reason} — tier 1 self-check failed`,
      });
      continue;
    }

    out.push({ ...placement, selfCheck: check });
  }

  return { placements: out, drops };
}
