import {
  coercePersonDepartment,
  departmentFromRelation,
  type PersonDepartment,
} from "../department";
import { optionLabels } from "../router/clarification-defaults";
import { safeTrim } from "../safe-trim";
import type {
  FashionClarificationQuestion,
  FashionIntakeQuestion,
  FashionSearchBrief,
  FashionStatedFacts,
} from "../router/types";
import type { FashionFactRow, PersonRow } from "../types";
import {
  garmentToSizeBucket,
  intakeFieldForBucket,
  isAmbiguousDepartmentGarment,
  sizeBucketsForGarments,
  type IntakeSizeField,
  type SizeGarmentBucket,
} from "./garment-size-fields";
import type { IntakeProfileHints } from "./account-profile-bridge";

/** @deprecated Prefer PersonDepartment — same value set. */
export type GenderPresentation = PersonDepartment;

export type FashionIntakePayload = {
  reply: string;
  target_person_id: string;
  questions: FashionIntakeQuestion[];
};

export type FashionBlockingClarification = {
  reply: string;
  target_person_id: string;
  questions: FashionClarificationQuestion[];
};

const MAX_INTAKE_QUESTIONS = 4;

export type FashionIntakeQuestionField = FashionIntakeQuestion["field"];

export function getGenderPresentation(
  facts: FashionFactRow[],
): PersonDepartment | null {
  const row = facts.find(
    (f) => f.fact_type === "gender_presentation" && f.status === "active",
  );
  if (!row) return null;
  const presentation = (row.value as { presentation?: string }).presentation;
  return coercePersonDepartment(presentation);
}

/** Sizes present in conversation stated_facts (not yet necessarily in DB). */
function statedSizeBuckets(
  stated?: FashionStatedFacts | null,
): Set<SizeGarmentBucket> {
  const out = new Set<SizeGarmentBucket>();
  const sizes = stated?.sizes;
  if (!sizes) return out;
  if (sizes.tops?.trim()) out.add("tops");
  if (sizes.bottoms?.trim()) out.add("bottoms");
  if (sizes.shoes?.trim()) out.add("shoes");
  if (sizes.dresses?.trim()) out.add("dresses");
  return out;
}

export function hasSizeForBucket(
  facts: FashionFactRow[],
  bucket: ReturnType<typeof garmentToSizeBucket>,
  hints?: IntakeProfileHints | null,
): boolean {
  if (!bucket) return false;
  if (hints?.sizeBuckets.has(bucket)) return true;
  return facts.some(
    (f) =>
      f.fact_type === "size" &&
      f.status === "active" &&
      safeTrim(f.garment_type).toLowerCase() === bucket,
  );
}

export function missingSizeBucketsForGarments(
  facts: FashionFactRow[],
  garments: string[],
  hints?: IntakeProfileHints | null,
  department?: PersonDepartment | string | null,
  stated?: FashionStatedFacts | null,
): ReturnType<typeof sizeBucketsForGarments> {
  const buckets = sizeBucketsForGarments(garments);
  const filtered =
    department === "mens" || department === "boys"
      ? buckets.filter((bucket) => bucket !== "dresses")
      : buckets;
  const statedBuckets = statedSizeBuckets(stated);
  return filtered.filter(
    (bucket) =>
      !hasSizeForBucket(facts, bucket, hints) && !statedBuckets.has(bucket),
  );
}

export function intakeAlreadyDone(person: PersonRow): boolean {
  return Boolean(person.intake_completed_at?.trim());
}

export function garmentsForIntakeGate(brief: FashionSearchBrief): string[] {
  if (brief.garments.length) return brief.garments;
  if (brief.request_type === "outfit") return ["shirt", "trousers", "shoes"];
  if (brief.request_type === "capsule") return ["top", "bottom", "shoes"];
  return ["top"];
}

/** True when gender is still unknown for this recipient/brief. */
export function missingGenderForIntake(params: {
  facts: FashionFactRow[];
  brief: FashionSearchBrief;
  profileHints?: IntakeProfileHints | null;
  /** Strong relations (mother → womens) skip the department question. */
  person?: Pick<PersonRow, "relation"> | null;
  stated?: FashionStatedFacts | null;
}): boolean {
  if (params.brief.department_scope) return false;
  if (coercePersonDepartment(params.stated?.department)) return false;
  if (getGenderPresentation(params.facts) != null) return false;
  if (params.profileHints?.genderPresentation) return false;
  if (departmentFromRelation(params.person?.relation)) return false;
  return true;
}

/** True when gender or garment-relevant sizes are still missing from facts. */
export function needsIntakeFacts(params: {
  facts: FashionFactRow[];
  brief: FashionSearchBrief;
  profileHints?: IntakeProfileHints | null;
  person?: Pick<PersonRow, "relation"> | null;
}): boolean {
  const garments = garmentsForIntakeGate(params.brief);
  const missingGender = missingGenderForIntake(params);
  const department =
    params.brief.department_scope ??
    getGenderPresentation(params.facts) ??
    departmentFromRelation(params.person?.relation);
  const missingSizes =
    missingSizeBucketsForGarments(
      params.facts,
      garments,
      params.profileHints,
      department,
    ).length > 0;
  return missingGender || missingSizes;
}

export function needsIntake(params: {
  person: PersonRow;
  facts: FashionFactRow[];
  brief: FashionSearchBrief;
  profileHints?: IntakeProfileHints | null;
}): boolean {
  return needsIntakeFacts({
    facts: params.facts,
    brief: params.brief,
    profileHints: params.profileHints,
    person: params.person,
  });
}

function sizeQuestionForField(
  field: IntakeSizeField,
  personLabel?: string,
): FashionIntakeQuestion {
  const clar = sizeClarificationForBucket(
    field === "size_tops"
      ? "tops"
      : field === "size_bottoms"
        ? "bottoms"
        : field === "size_shoes"
          ? "shoes"
          : "dresses",
    personLabel,
  );
  return {
    field,
    question: clar.text,
    quick_options: optionLabels(clar.quick_options),
  };
}

function sizeClarificationForBucket(
  bucket: SizeGarmentBucket,
  personLabel?: string,
): FashionClarificationQuestion {
  const who = personLabel?.trim();
  const forGift = Boolean(who && who !== "you");
  const field = intakeFieldForBucket(bucket);
  switch (bucket) {
    case "tops":
      return {
        text: forGift
          ? `What size does ${who} usually wear in tops?`
          : "What size do you usually wear in tops?",
        gap: "size",
        garment_type: "tops",
        field,
        quick_options: ["XS", "S", "M", "L", "XL", "Other"],
      };
    case "bottoms":
      return {
        text: forGift
          ? `And for ${who}'s bottoms — waist/size?`
          : "And for bottoms — waist/size?",
        gap: "size",
        garment_type: "bottoms",
        field,
        quick_options: ["28", "30", "32", "34", "36", "Other"],
      };
    case "shoes":
      return {
        text: forGift ? `${who}'s shoe size?` : "Shoe size?",
        gap: "size",
        garment_type: "shoes",
        field,
        quick_options: ["7", "8", "9", "10", "11", "Other"],
      };
    case "dresses":
      return {
        text: forGift
          ? `What's ${who}'s typical dress size?`
          : "Dress size?",
        gap: "size",
        garment_type: "dresses",
        field,
        quick_options: ["XS", "S", "M", "L", "XL", "Other"],
      };
  }
}

export function buildIntakeQuestions(params: {
  brief: FashionSearchBrief;
  facts: FashionFactRow[];
  personLabel?: string;
  person?: Pick<PersonRow, "relation"> | null;
  profileHints?: IntakeProfileHints | null;
}): FashionIntakeQuestion[] {
  const questions: FashionIntakeQuestion[] = [];

  if (
    missingGenderForIntake({
      facts: params.facts,
      brief: params.brief,
      profileHints: params.profileHints,
      person: params.person,
    })
  ) {
    const who = params.personLabel?.trim();
    questions.push({
      field: "gender_presentation",
      question:
        who && who !== "you"
          ? `Which section should I shop for ${who}?`
          : "Which section should I shop for you?",
      quick_options: ["Men's", "Women's", "Mix it", "Other"],
    });
  }

  const garments = garmentsForIntakeGate(params.brief);
  const department =
    params.brief.department_scope ??
    getGenderPresentation(params.facts) ??
    departmentFromRelation(params.person?.relation);
  const missingBuckets = missingSizeBucketsForGarments(
    params.facts,
    garments,
    params.profileHints,
    department,
  );
  for (const bucket of missingBuckets) {
    if (questions.length >= MAX_INTAKE_QUESTIONS) break;
    questions.push(
      sizeQuestionForField(intakeFieldForBucket(bucket), params.personLabel),
    );
  }

  return questions.slice(0, MAX_INTAKE_QUESTIONS);
}

export function buildIntakePayload(params: {
  brief: FashionSearchBrief;
  facts: FashionFactRow[];
  targetPersonId: string;
  personLabel?: string;
  person?: PersonRow;
  profileHints?: IntakeProfileHints | null;
}): FashionIntakePayload {
  const blocking = buildBlockingClarification({
    brief: params.brief,
    facts: params.facts,
    targetPersonId: params.targetPersonId,
    personLabel: params.personLabel,
    person: params.person,
    profileHints: params.profileHints,
  });
  return {
    reply: blocking.reply,
    target_person_id: blocking.target_person_id,
    questions: blocking.questions
      .filter((q) => q.field)
      .map((q) => ({
        field: q.field!,
        question: q.text,
        quick_options: optionLabels(q.quick_options),
      })),
  };
}

/** Deterministic department + size checklist used as gate fallback templates. */
export function buildBlockingClarification(params: {
  brief: FashionSearchBrief;
  facts: FashionFactRow[];
  targetPersonId: string;
  personLabel?: string;
  person?: PersonRow | Pick<PersonRow, "relation"> | null;
  profileHints?: IntakeProfileHints | null;
  /** Conversation stated_facts — merged with DB for asymmetry-safe builders. */
  stated?: FashionStatedFacts | null;
}): FashionBlockingClarification {
  const questions: FashionClarificationQuestion[] = [];
  const who = params.personLabel?.trim() || "you";
  const stated = params.stated ?? params.brief.stated_facts ?? null;

  if (
    missingGenderForIntake({
      facts: params.facts,
      brief: params.brief,
      profileHints: params.profileHints,
      person: params.person,
      stated,
    })
  ) {
    questions.push({
      text:
        who && who !== "you"
          ? `Which section should I shop for ${who}?`
          : "Which section should I shop for you?",
      gap: "department",
      field: "gender_presentation",
      quick_options: ["Men's", "Women's", "Mix it", "Other"],
    });
  }

  const garments = garmentsForIntakeGate(params.brief);
  const department =
    params.brief.department_scope ??
    coercePersonDepartment(stated?.department) ??
    getGenderPresentation(params.facts) ??
    departmentFromRelation(params.person?.relation);
  const missingBuckets = missingSizeBucketsForGarments(
    params.facts,
    garments,
    params.profileHints,
    department,
    stated,
  );
  for (const bucket of missingBuckets) {
    if (questions.length >= MAX_INTAKE_QUESTIONS) break;
    questions.push(sizeClarificationForBucket(bucket, params.personLabel));
  }

  const reply =
    questions.length > 1
      ? `20 seconds of essentials so everything I pull actually fits — and I only ask once.`
      : questions[0]?.gap === "department"
        ? "Quick one — which section should I shop so this pulls correctly?"
        : "Quick sizing so everything I pull actually fits.";

  return {
    reply,
    target_person_id: params.targetPersonId,
    questions: questions.slice(0, MAX_INTAKE_QUESTIONS),
  };
}

export function requiresDepartmentDecomposition(brief: FashionSearchBrief): boolean {
  if (brief.request_type === "outfit" || brief.request_type === "capsule") {
    return true;
  }
  return brief.garments.some((g) => isAmbiguousDepartmentGarment(g));
}

export function needsDepartmentClarification(params: {
  brief: FashionSearchBrief;
  facts: FashionFactRow[];
  person: PersonRow;
  profileHints?: IntakeProfileHints | null;
}): boolean {
  if (getGenderPresentation(params.facts) != null) return false;
  if (params.profileHints?.genderPresentation) return false;
  if (params.brief.department_scope) return false;
  if (departmentFromRelation(params.person.relation)) return false;
  return requiresDepartmentDecomposition(params.brief);
}

export function buildDepartmentClarification(personLabel?: string): {
  reply: string;
  questions: FashionClarificationQuestion[];
} {
  const who = personLabel?.trim();
  return {
    reply:
      "Quick one — which section should I shop so the outfit breaks down correctly?",
    questions: [
      {
        text:
          who && who !== "you"
            ? `Which section should I shop for ${who}?`
            : "Which section should I shop for you?",
        gap: "department",
        field: "gender_presentation",
        quick_options: ["Men's", "Women's", "Mix it", "Other"],
      },
    ],
  };
}

export function parseDepartmentAnswer(text: string): GenderPresentation | null {
  const t = text.trim().toLowerCase();
  if (/^men'?s?$|^mens$/.test(t)) return "mens";
  if (/^women'?s?$|^womens$/.test(t)) return "womens";
  if (/^mix(\s*it)?$|^both$|^mixed$/.test(t)) return "mixed";
  return null;
}

/**
 * Kids department from age language + relation ("8 year old son" → boys).
 * Adult relation defaults stay in departmentFromRelation.
 */
export function inferKidsDepartmentFromMessage(
  text: string,
): GenderPresentation | null {
  const ageMatch =
    text.match(/\b(\d{1,2})\s*(?:year|yr|y\.?o\.?)s?\s*old\b/i) ??
    text.match(/\b(\d{1,2})\s*yo\b/i);
  if (!ageMatch) return null;
  const age = Number(ageMatch[1]);
  if (!Number.isFinite(age) || age < 0 || age > 17) return null;
  if (age < 2) return "baby";
  if (/\b(daughter|girl)\b/i.test(text)) return "girls";
  if (/\b(son|boy)\b/i.test(text)) return "boys";
  return null;
}

/** Parses department from quick-option taps or batched intake replies. */
export function parseDepartmentFromMessage(text: string): GenderPresentation | null {
  const standalone = parseDepartmentAnswer(text);
  if (standalone) return standalone;

  const kids = inferKidsDepartmentFromMessage(text);
  if (kids) return kids;

  const segments = text.split(/\.\s+/);
  for (const segment of segments) {
    if (!/(department|section should i shop|which section)/i.test(segment)) continue;
    const questionMarkIdx = segment.lastIndexOf("?");
    if (questionMarkIdx >= 0) {
      const parsed = parseDepartmentAnswer(segment.slice(questionMarkIdx + 1).trim());
      if (parsed) return parsed;
    }
  }

  return null;
}

export function computeSizesUnconfirmed(params: {
  person: PersonRow;
  facts: FashionFactRow[];
  brief: FashionSearchBrief;
  profileHints?: IntakeProfileHints | null;
}): string[] {
  void params.person;
  const department =
    params.brief.department_scope ??
    getGenderPresentation(params.facts) ??
    departmentFromRelation(params.person.relation);
  return missingSizeBucketsForGarments(
    params.facts,
    garmentsForIntakeGate(params.brief),
    params.profileHints,
    department,
  );
}

export function garmentTypesForUnconfirmedBuckets(
  buckets: ReturnType<typeof missingSizeBucketsForGarments>,
  briefGarments: string[],
): string[] {
  const bucketSet = new Set(buckets);
  const matched = briefGarments.filter((g) => {
    const b = garmentToSizeBucket(g);
    return b != null && bucketSet.has(b);
  });
  return matched.length ? matched : briefGarments;
}

export { bucketForIntakeField } from "./garment-size-fields";
