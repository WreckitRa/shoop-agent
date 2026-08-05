import type { OnboardingExtraction } from "./types";

type Obs = OnboardingExtraction["observations"][number];

/** True when an observation describes the chatting buyer — not a gift recipient. */
export function observationTargetsBuyer(
  o: Pick<Obs, "scope" | "recipientLabel" | "signalType">,
): boolean {
  if (o.signalType === "gift_recipient") return false;
  if (o.scope === "recipient") return false;
  if (o.recipientLabel?.trim()) return false;
  return true;
}

/** Profile identity fields — only editable via settings / onboarding, never chat memory. */
export const CHAT_PROTECTED_PROFILE_IDENTITY_KEYS = [
  "preferredName",
  "pronouns",
  "ageRange",
  "birthDate",
  "genderPresentation",
] as const;

export function stripChatProtectedIdentityFields(
  data: Record<string, unknown>,
): void {
  for (const key of CHAT_PROTECTED_PROFILE_IDENTITY_KEYS) {
    delete data[key];
  }
}
