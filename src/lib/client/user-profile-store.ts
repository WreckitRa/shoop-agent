"use client";

import { create } from "zustand";
import {
  canFetchUserScopedData,
  useAppSessionStore,
} from "@/lib/client/app-session";
import { extractFirstName } from "@/lib/shared/timeGreeting";
import { getUserInitials } from "@/lib/shared/userInitials";
import {
  catalogLocalizationFromProfile,
  resolveCatalogLocalization,
  type CatalogLocalization,
} from "@/lib/shopify/catalog-localization";
import { SHOPIFY_COUNTRIES } from "@/lib/cart/countries";
import { currencyHintForCountry } from "@/lib/onboarding/form-options";
import { guestFetch } from "@/lib/client/guest-fetch";
import { getGuestSessionId } from "@/lib/client/guest-storage";
import type { DetectedRequestArea } from "@/lib/server/request-area";

export type UserIdentity = {
  userId: string;
  email: string | null;
  preferredName: string | null;
  initials: string;
  firstName: string;
};

const STALE_MS = 5 * 60_000;

let hydratePromise: Promise<void> | null = null;

function buildIdentity(
  userId: string,
  email: string | null,
  preferredName: string | null,
): UserIdentity {
  return {
    userId,
    email,
    preferredName,
    initials: getUserInitials(preferredName, email),
    firstName:
      extractFirstName(preferredName) ??
      email?.split("@")[0]?.trim() ??
      "Account",
  };
}

export type ProfileBodyFacts = {
  genderPresentation: string | null;
  heightCm: number | null;
  bodyType: string | null;
};

type UserProfileState = {
  identity: UserIdentity | null;
  catalogLocalization: CatalogLocalization | null;
  catalogLocalizationSource: "profile" | "ip";
  detectedArea: DetectedRequestArea | null;
  onboardingCompleted: boolean | null;
  body: ProfileBodyFacts | null;
  loadedAt: number;
  hydrating: boolean;
  savingShippingCountry: boolean;
  hydrate: (opts?: { force?: boolean }) => Promise<void>;
  updateProfileLocale: (
    countryCode: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  updateProfileCurrency: (
    currencyCode: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** @deprecated Use updateProfileLocale */
  updateShippingCountry: (
    countryCode: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  seedIdentity: (partial: {
    userId?: string;
    email?: string | null;
    preferredName?: string | null;
  }) => void;
  setOnboardingCompleted: (completed: boolean) => void;
  reset: () => void;
};

export const useUserProfileStore = create<UserProfileState>((set, get) => ({
  identity: null,
  catalogLocalization: null,
  catalogLocalizationSource: "profile",
  detectedArea: null,
  onboardingCompleted: null,
  body: null,
  loadedAt: 0,
  hydrating: false,
  savingShippingCountry: false,

  setOnboardingCompleted: (completed) => {
    set({ onboardingCompleted: completed, loadedAt: Date.now() });
  },

  seedIdentity: (partial) => {
    if (
      partial.preferredName === null &&
      (partial.email === null || partial.email === undefined) &&
      !partial.userId
    ) {
      set({ identity: null, loadedAt: 0 });
      return;
    }

    const current = get().identity;
    const userId = partial.userId ?? current?.userId ?? "local";
    const email =
      partial.email !== undefined ? partial.email : (current?.email ?? null);
    const preferredName =
      partial.preferredName !== undefined
        ? partial.preferredName
        : (current?.preferredName ?? null);
    if (!preferredName?.trim() && !email?.trim()) {
      set({ identity: null, loadedAt: 0 });
      return;
    }
    set({
      identity: buildIdentity(userId, email, preferredName?.trim() || null),
      loadedAt: Date.now(),
    });
  },

  reset: () => {
    hydratePromise = null;
    set({
      identity: null,
      catalogLocalization: null,
      catalogLocalizationSource: "profile",
      detectedArea: null,
      onboardingCompleted: null,
      body: null,
      loadedAt: 0,
      hydrating: false,
      savingShippingCountry: false,
    });
  },

  updateProfileLocale: async (countryCode) => {
    const country = SHOPIFY_COUNTRIES.find((c) => c.code === countryCode);
    if (!country) return { ok: false, error: "Invalid country" };

    const previous = get().catalogLocalization;
    const previousCurrency = previous?.currency ?? null;
    const currencyHint = currencyHintForCountry(country.label);
    const nextCurrency = previousCurrency ?? currencyHint;
    set({
      savingShippingCountry: true,
      catalogLocalization: {
        ...resolveCatalogLocalization(country.label, null),
        currency: nextCurrency,
      },
      catalogLocalizationSource: "profile",
    });

    try {
      const body: Record<string, string> = { shippingCountry: country.label };
      if (!previousCurrency && currencyHint) {
        body.currency = currencyHint;
      }
      const res = await guestFetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        set({ catalogLocalization: previous });
        return { ok: false, error: "Could not save country" };
      }
      set({ loadedAt: Date.now() });
      return { ok: true };
    } catch {
      set({ catalogLocalization: previous });
      return { ok: false, error: "Could not save country" };
    } finally {
      set({ savingShippingCountry: false });
    }
  },

  updateProfileCurrency: async (currencyCode) => {
    const currency = currencyCode.trim().toUpperCase().slice(0, 6);
    if (!currency) return { ok: false, error: "Invalid currency" };

    const previous = get().catalogLocalization;
    const countryRaw = previous?.profileRaw ?? previous?.countryLabel ?? null;
    set({
      savingShippingCountry: true,
      catalogLocalization: countryRaw
        ? { ...resolveCatalogLocalization(countryRaw, null), currency }
        : {
            profileRaw: null,
            countryCode: null,
            shipsTo: null,
            addressCountry: null,
            countryLabel: null,
            currency,
          },
    });

    try {
      const res = await guestFetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency }),
      });
      if (!res.ok) {
        set({ catalogLocalization: previous });
        return { ok: false, error: "Could not save currency" };
      }
      set({ loadedAt: Date.now() });
      return { ok: true };
    } catch {
      set({ catalogLocalization: previous });
      return { ok: false, error: "Could not save currency" };
    } finally {
      set({ savingShippingCountry: false });
    }
  },

  updateShippingCountry: async (countryCode) =>
    get().updateProfileLocale(countryCode),

  hydrate: async (opts) => {
    if (!canFetchUserScopedData(useAppSessionStore.getState().mode)) {
      get().reset();
      return;
    }

    const { identity, loadedAt } = get();
    const isFresh = identity && Date.now() - loadedAt < STALE_MS;

    if (!opts?.force && isFresh) return;
    if (hydratePromise) return hydratePromise;

    hydratePromise = (async () => {
      set({ hydrating: true });
      try {
        const { mode, authUserId, authUserEmail } =
          useAppSessionStore.getState();

        const profileRes =
          mode === "guest"
            ? await guestFetch("/api/profile", { cache: "no-store" })
            : authUserId
              ? await fetch("/api/profile", { cache: "no-store" })
              : null;

        if (mode !== "guest" && mode !== "authenticated" && mode !== "local") {
          get().reset();
          return;
        }

        let preferredName: string | null = null;
        let onboardingCompleted: boolean | null = null;
        let catalogLocalization: CatalogLocalization | null = null;
        let catalogLocalizationSource: "profile" | "ip" = "profile";
        let detectedArea: DetectedRequestArea | null = null;
        let body: ProfileBodyFacts | null = null;
        if (profileRes?.ok) {
          const profileJson = (await profileRes.json()) as {
            profile?: {
              preferredName?: string | null;
              onboardingCompleted?: boolean;
              shippingCountry?: string | null;
              country?: string | null;
              currency?: string | null;
              genderPresentation?: string | null;
            };
            sizing?: {
              heightCm?: number | null;
              bodyType?: string | null;
            } | null;
            catalogLocalization?: CatalogLocalization | null;
            catalogLocalizationSource?: "profile" | "ip";
            detectedArea?: DetectedRequestArea | null;
          };
          preferredName = profileJson.profile?.preferredName?.trim() || null;
          onboardingCompleted =
            profileJson.profile?.onboardingCompleted ?? false;
          catalogLocalization =
            profileJson.catalogLocalization ??
            (profileJson.profile
              ? catalogLocalizationFromProfile(profileJson.profile)
              : null);
          catalogLocalizationSource =
            profileJson.catalogLocalizationSource ?? "profile";
          detectedArea = profileJson.detectedArea ?? null;
          body = {
            genderPresentation:
              profileJson.profile?.genderPresentation?.trim() || null,
            heightCm: profileJson.sizing?.heightCm ?? null,
            bodyType: profileJson.sizing?.bodyType?.trim() || null,
          };
        }

        const guestSessionId = getGuestSessionId();
        const userId =
          mode === "guest" && guestSessionId
            ? `guest-${guestSessionId}`
            : (authUserId ?? "local");

        set({
          identity: buildIdentity(
            userId,
            mode === "guest" ? null : authUserEmail,
            preferredName ?? (mode === "guest" ? "Guest" : null),
          ),
          catalogLocalization,
          catalogLocalizationSource,
          detectedArea,
          onboardingCompleted,
          body,
          loadedAt: Date.now(),
        });
      } finally {
        set({ hydrating: false });
        hydratePromise = null;
      }
    })();

    return hydratePromise;
  },
}));
