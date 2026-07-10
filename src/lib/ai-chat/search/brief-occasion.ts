/**
 * Resolve ambiguous occasion words (e.g. "work") against profile context.
 */
import { applyProvenanceToBrief } from "./brief-provenance";
import { tagListProvenance } from "./brief-provenance";
import type { SearchBrief } from "./types";

export type OccasionProfile = {
  workEnvironment?: string | null;
  lifestyleTags?: string[];
  occupation?: string | null;
};

const WORK_TOKENS = /\b(work|office|professional|business)\b/i;
const NIGHTLIFE_TOKENS =
  /\b(nightlife|club|dj|events?|party|evening|after.?hours)\b/i;

function profileSignalsNightlife(profile: OccasionProfile): boolean {
  const env = (profile.workEnvironment ?? "").toLowerCase();
  const tags = (profile.lifestyleTags ?? []).join(" ").toLowerCase();
  const occ = (profile.occupation ?? "").toLowerCase();
  const blob = `${env} ${tags} ${occ}`;
  return NIGHTLIFE_TOKENS.test(blob);
}

function profileSignalsOffice(profile: OccasionProfile): boolean {
  const env = (profile.workEnvironment ?? "").toLowerCase();
  return /\b(office|corporate|9-5|nine.to.five|business)\b/i.test(env);
}

/**
 * When the brief says "work/office" but the profile's work env is nightlife,
 * resolve the primary occasion to nightlife and demote office wording to nice-to-have.
 */
export function resolveOccasionAmbiguity(
  brief: SearchBrief,
  profile?: OccasionProfile | null,
): SearchBrief {
  if (!profile || brief.recipient.kind === "other") return brief;

  const hasWorkLanguage =
    WORK_TOKENS.test(brief.useCase ?? "") ||
    brief.mustHaves.some((m) => WORK_TOKENS.test(m));
  if (!hasWorkLanguage) return brief;

  const nightlife = profileSignalsNightlife(profile);
  const office = profileSignalsOffice(profile);

  if (nightlife && !office) {
    const mustHaves = brief.mustHaves.filter((m) => !WORK_TOKENS.test(m));
    const niceToHaves = [
      ...brief.niceToHaves,
      ...brief.mustHaves.filter((m) => WORK_TOKENS.test(m)),
    ];
    const resolution =
      'Resolved "work/office" → nightlife/events (profile workEnvironment/lifestyle)';
    return applyProvenanceToBrief(
      {
        ...brief,
        useCase: "nightlife and events",
        mustHaves,
        niceToHaves: [...new Set(niceToHaves.map((s) => s.trim()).filter(Boolean))],
      },
      {
        useCase: "profile_default",
        mustHaves: tagListProvenance(mustHaves, "profile_default"),
        niceToHaves: tagListProvenance(niceToHaves, "persona_inferred"),
        occasionResolution: resolution,
      },
    );
  }

  if (office || !nightlife) {
    const resolution = office
      ? 'Kept "work/office" reading (profile workEnvironment confirms office)'
      : 'Kept "work/office" reading (default — no nightlife profile signal)';
    return applyProvenanceToBrief(brief, {
      useCase: brief.useCase ? "user_stated" : "profile_default",
      occasionResolution: resolution,
    });
  }

  return brief;
}
