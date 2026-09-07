import { FITTING_STEPS, isMagicFittingStep, type FittingStep } from "./types";
import { FITTING_TRACE_STORAGE_KEY } from "@/lib/onboarding/fitting-trace-shared";

export const ONBOARDING_UI_SESSION_KEY = "shoop.onboarding.ui.v4";

export type OnboardingUiFinale = "scan" | "card";

export type OnboardingUiIdentity = {
  preferredName?: string;
  genderPresentation?: string;
  styleEras?: string[];
};

export type OnboardingUiSession = {
  step: FittingStep;
  finale?: OnboardingUiFinale;
  /** User closed The Fitting — do not auto-reopen on refresh. */
  dismissed?: boolean;
  /** Scan/verdict — Fitting owns the viewport. */
  locked?: boolean;
  /** After signup, save verdict looks then close The Fitting. */
  saveLooks?: boolean;
  lookJobIds?: string[];
  /** After signup, close The Fitting without saving looks. */
  completeAfterAuth?: boolean;
  /** Name / clothing / era — survives guest→account remount. */
  identity?: OnboardingUiIdentity;
  /** Debug: NEXT_PUBLIC_FITTING_TRACE session id. */
  fittingTraceId?: string;
};

function isFittingStep(v: unknown): v is FittingStep {
  return typeof v === "string" && (FITTING_STEPS as string[]).includes(v);
}

/** Leftover "circle" sessions land on the verdict card. */
function parseStep(v: unknown): FittingStep | null {
  if (v === "circle") return "verdict";
  return isFittingStep(v) ? v : null;
}

function parseLookJobIds(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const ids = v
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id.length < 80)
    .slice(0, 8);
  return ids.length ? ids : undefined;
}

function parseFittingTraceId(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const id = v.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  )
    ? id
    : undefined;
}

function parseIdentity(v: unknown): OnboardingUiIdentity | undefined {
  if (!v || typeof v !== "object") return undefined;
  const row = v as Record<string, unknown>;
  const preferredName =
    typeof row.preferredName === "string" ? row.preferredName.trim() : "";
  const genderPresentation =
    typeof row.genderPresentation === "string"
      ? row.genderPresentation.trim()
      : "";
  const styleEras = Array.isArray(row.styleEras)
    ? row.styleEras
        .filter((e): e is string => typeof e === "string")
        .map((e) => e.trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  if (!preferredName && !genderPresentation && !styleEras.length) {
    return undefined;
  }
  return {
    preferredName: preferredName || undefined,
    genderPresentation: genderPresentation || undefined,
    styleEras: styleEras.length ? styleEras : undefined,
  };
}

function parseSession(raw: string | null): OnboardingUiSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rawStep = parsed.step;
    const step = parseStep(rawStep);
    if (!step) return null;
    const finale =
      parsed.finale === "scan" || parsed.finale === "card"
        ? parsed.finale
        : rawStep === "circle"
          ? "card"
          : undefined;
    return {
      step,
      finale,
      dismissed: parsed.dismissed === true,
      locked: parsed.locked === true,
      saveLooks: parsed.saveLooks === true,
      lookJobIds: parseLookJobIds(parsed.lookJobIds),
      completeAfterAuth: parsed.completeAfterAuth === true,
      identity: parseIdentity(parsed.identity),
      fittingTraceId: parseFittingTraceId(parsed.fittingTraceId),
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

function readStoredFittingTraceId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return (
      parseFittingTraceId(window.sessionStorage.getItem(FITTING_TRACE_STORAGE_KEY)) ??
      parseFittingTraceId(window.localStorage.getItem(FITTING_TRACE_STORAGE_KEY))
    );
  } catch {
    return undefined;
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
    finale: pos.finale ?? prev?.finale,
    dismissed: "dismissed" in pos ? pos.dismissed : prev?.dismissed,
    locked: "locked" in pos ? pos.locked : prev?.locked,
    saveLooks: "saveLooks" in pos ? pos.saveLooks : prev?.saveLooks,
    lookJobIds: "lookJobIds" in pos ? pos.lookJobIds : prev?.lookJobIds,
    completeAfterAuth:
      "completeAfterAuth" in pos
        ? pos.completeAfterAuth
        : prev?.completeAfterAuth,
    identity: pos.identity ?? prev?.identity,
    fittingTraceId:
      parseFittingTraceId(pos.fittingTraceId) ??
      prev?.fittingTraceId ??
      readStoredFittingTraceId(),
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

/** Scan/verdict owns the viewport until they log in or quit. */
export function sessionIsMagicLocked(
  session: OnboardingUiSession | null,
): boolean {
  if (!session || session.dismissed === true) return false;
  return session.locked === true || isMagicFittingStep(session.step);
}

/** Verdict (and a pending look-save) — keep Fitting open after signup. */
export function isFinishingFitting(
  session: OnboardingUiSession | null,
): boolean {
  if (!session || session.dismissed === true) return false;
  return (
    session.step === "verdict" ||
    session.saveLooks === true ||
    session.completeAfterAuth === true
  );
}
