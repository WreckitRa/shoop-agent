"use client";

import {
  FITTING_TRACE_STORAGE_KEY,
  isFittingTraceId,
  isFittingTracePublicEnabled,
} from "@/lib/onboarding/fitting-trace-shared";
import { readOnboardingUiSession, writeOnboardingUiSession } from "./ui-session";

export { FITTING_TRACE_HEADER } from "@/lib/onboarding/fitting-trace-shared";
export { isFittingTracePublicEnabled };

function storageGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return (
      window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key)
    );
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
    window.localStorage.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

export function getFittingTraceId(): string | null {
  if (!isFittingTracePublicEnabled()) return null;
  const fromSession = readOnboardingUiSession()?.fittingTraceId;
  if (isFittingTraceId(fromSession)) return fromSession;
  const stored = storageGet(FITTING_TRACE_STORAGE_KEY);
  return isFittingTraceId(stored) ? stored : null;
}

export function ensureFittingTraceId(): string | null {
  if (!isFittingTracePublicEnabled() || typeof window === "undefined") {
    return null;
  }
  const existing = getFittingTraceId();
  if (existing) {
    persistFittingTraceId(existing);
    return existing;
  }
  const id = crypto.randomUUID();
  persistFittingTraceId(id);
  return id;
}

function persistFittingTraceId(id: string) {
  storageSet(FITTING_TRACE_STORAGE_KEY, id);
  const prev = readOnboardingUiSession();
  if (prev && prev.fittingTraceId !== id) {
    writeOnboardingUiSession({ fittingTraceId: id });
  }
}

export function summarizeFittingTraceBody(
  body: BodyInit | null | undefined,
): unknown {
  if (body == null) return undefined;
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        return parsed;
      } catch {
        return `[json ${body.length} chars]`;
      }
    }
    return `[text ${body.length} chars]`;
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const fields: string[] = [];
    for (const [key, value] of body.entries()) {
      fields.push(
        value instanceof Blob
          ? `${key}:blob(${value.size})`
          : `${key}:str(${String(value).length})`,
      );
    }
    return { form: fields };
  }
  return "[body]";
}
