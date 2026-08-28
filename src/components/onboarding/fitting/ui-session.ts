import { FITTING_STEPS, type FittingStep } from "./types";

export const ONBOARDING_UI_SESSION_KEY = "shoop.onboarding.ui.v4";

export type OnboardingUiFinale = "scan" | "card";

export type OnboardingUiSession = {
  step: FittingStep;
  circleNames?: string[];
  finale?: OnboardingUiFinale;
  /** User closed The Fitting — do not auto-reopen on refresh. */
  dismissed?: boolean;
};

function isFittingStep(v: unknown): v is FittingStep {
  return typeof v === "string" && (FITTING_STEPS as string[]).includes(v);
}

function parseCircleNames(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const names = v
    .filter((n): n is string => typeof n === "string")
    .map((n) => n.trim())
    .slice(0, 3);
  if (!names.some(Boolean)) return undefined;
  return [names[0] ?? "", names[1] ?? "", names[2] ?? ""];
}

function parseSession(raw: string | null): OnboardingUiSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingUiSession>;
    if (!isFittingStep(parsed.step)) return null;
    const finale =
      parsed.finale === "scan" || parsed.finale === "card"
        ? parsed.finale
        : undefined;
    return {
      step: parsed.step,
      circleNames: parseCircleNames(parsed.circleNames),
      finale,
      dismissed: parsed.dismissed === true,
    };
  } catch {
    return null;
  }
}

function storageGet(store: Storage | undefined): OnboardingUiSession | null {
  if (!store) return null;
  try {
    return parseSession(store.getItem(ONBOARDING_UI_SESSION_KEY));
  } catch {
    return null;
  }
}

function storageSet(store: Storage | undefined, value: string) {
  if (!store) return;
  try {
    store.setItem(ONBOARDING_UI_SESSION_KEY, value);
  } catch {
    /* ignore quota / private mode */
  }
}

function storageRemove(store: Storage | undefined) {
  if (!store) return;
  try {
    store.removeItem(ONBOARDING_UI_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** localStorage first (survives refresh); sessionStorage as a one-tab fallback. */
export function readOnboardingUiSession(): OnboardingUiSession | null {
  if (typeof window === "undefined") return null;
  return (
    storageGet(window.localStorage) ?? storageGet(window.sessionStorage)
  );
}

export function writeOnboardingUiSession(
  pos: Partial<OnboardingUiSession> & { step?: FittingStep },
) {
  if (typeof window === "undefined") return;
  const prev = readOnboardingUiSession();
  const step = pos.step ?? prev?.step;
  if (!step) return;
  const next: OnboardingUiSession = {
    step,
    circleNames: pos.circleNames ?? prev?.circleNames,
    finale: pos.finale ?? prev?.finale,
    dismissed: "dismissed" in pos ? pos.dismissed : prev?.dismissed,
  };
  const raw = JSON.stringify(next);
  storageSet(window.localStorage, raw);
  storageSet(window.sessionStorage, raw);
}

export function clearOnboardingUiSession() {
  if (typeof window === "undefined") return;
  storageRemove(window.localStorage);
  storageRemove(window.sessionStorage);
}

export function markOnboardingUiDismissed() {
  const prev = readOnboardingUiSession();
  if (!prev) {
    writeOnboardingUiSession({ step: "consent", dismissed: true });
    return;
  }
  writeOnboardingUiSession({ ...prev, dismissed: true });
}

export function markOnboardingUiResumed() {
  const prev = readOnboardingUiSession();
  if (!prev) return;
  writeOnboardingUiSession({ ...prev, dismissed: false });
}

/** Last step — after save/login, close Fitting onto the You mirror. */
export function isFinishingFitting(
  session: OnboardingUiSession | null,
): boolean {
  return Boolean(
    session && session.step === "verdict" && session.dismissed !== true,
  );
}
