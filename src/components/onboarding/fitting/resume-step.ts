import { FITTING_STEPS, type FittingStep } from "./types";

export type ResumeStatus = {
  onboarding: { started: boolean; completed: boolean };
  profile: {
    preferredName: string | null;
    genderPresentation: string | null;
    styleEra: string | null;
    ageRange: string | null;
    weekIs: string | null;
    dressingFor: string | null;
    kids: string | null;
    climate: string | null;
    valuePhilosophy: string | null;
    honestyPreference: string | null;
  } | null;
  sizing: {
    heightCm?: number | null;
    bodyType?: string | null;
  } | null;
  tasteTags: Array<{ category?: string | null }>;
  brandPreferences: unknown[];
  hardNegatives: unknown[];
};

function hasYou(profile: ResumeStatus["profile"]): boolean {
  if (!profile) return false;
  return Boolean(
    profile.preferredName?.trim() &&
      profile.genderPresentation?.trim() &&
      (profile.styleEra?.trim() || profile.ageRange?.trim()),
  );
}

function hasLife(profile: ResumeStatus["profile"]): boolean {
  if (!profile) return false;
  return Boolean(
    profile.weekIs?.trim() ||
      profile.dressingFor?.trim() ||
      profile.kids?.trim() ||
      profile.climate?.trim(),
  );
}

function hasCategory(
  tags: ResumeStatus["tasteTags"],
  category: string,
): boolean {
  return tags.some((t) => t.category === category);
}

/** First Fitting step that still needs an answer. Completed / restart → photo. */
export function firstIncompleteFittingStep(
  status: ResumeStatus,
): FittingStep {
  if (status.onboarding.completed) return "photo";
  if (!status.onboarding.started) return "consent";
  const profile = status.profile;
  if (!status.sizing?.heightCm && !status.sizing?.bodyType) return "fit";
  if (!hasYou(profile)) return "name";
  if (!hasLife(profile)) return "life";
  if (!profile?.valuePhilosophy?.trim()) return "spend";
  if (!hasCategory(status.tasteTags, "worn")) return "worn";
  if (!profile?.honestyPreference?.trim()) {
    return status.brandPreferences.length > 0 ||
      status.hardNegatives.length > 0
      ? "honesty"
      : "nolist";
  }
  return "verdict";
}

/**
 * Resume mid-flow at the furthest of (first incomplete, session).
 * Restart or completed always returns photo — caller clears session storage.
 */
export function resolveFittingResumeStep(
  status: ResumeStatus,
  sessionStep: FittingStep | null,
  opts?: { restart?: boolean },
): FittingStep {
  if (opts?.restart || status.onboarding.completed) return "photo";
  const floor = firstIncompleteFittingStep(status);
  if (!sessionStep) return floor;
  const floorIdx = FITTING_STEPS.indexOf(floor);
  const sessionIdx = FITTING_STEPS.indexOf(sessionStep);
  if (sessionIdx < 0) return floor;
  if (sessionIdx < floorIdx) return floor;
  return sessionStep;
}

/**
 * Auto-open Fitting only to resume an in-progress session the shopper
 * hasn't closed. Completed / first visit / dismissed stay on the home mirror.
 */
export function shouldAutoResumeFitting(args: {
  completed: boolean;
  replay: boolean;
  sessionDismissed: boolean;
  hasSession: boolean;
}): boolean {
  if (args.replay) return true;
  if (args.completed) return false;
  if (args.sessionDismissed) return false;
  return args.hasSession;
}
