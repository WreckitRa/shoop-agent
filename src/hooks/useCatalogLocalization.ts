"use client";

import { useEffect, useMemo } from "react";
import {
  canFetchUserScopedData,
  useAppSessionStore,
} from "@/lib/client/app-session";
import { useUserProfileStore } from "@/lib/client/user-profile-store";
import { useChatStore } from "@/components/chat/chat-store";
import {
  resolveEffectiveCatalogLocalization,
  type CatalogLocalization,
} from "@/lib/shopify/catalog-localization";

/** Cached profile defaults + per-chat overrides for catalog search. */
export function useCatalogLocalization() {
  const accessMode = useAppSessionStore((s) => s.mode);
  const profileLocalization = useUserProfileStore((s) => s.catalogLocalization);
  const profileHydrating = useUserProfileStore((s) => s.hydrating);
  const profileSaving = useUserProfileStore((s) => s.savingShippingCountry);
  const updateProfileLocale = useUserProfileStore((s) => s.updateProfileLocale);
  const updateProfileCurrency = useUserProfileStore(
    (s) => s.updateProfileCurrency,
  );
  const hydrateProfile = useUserProfileStore((s) => s.hydrate);

  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const conversationMeta = useChatStore((s) => s.conversationMeta);
  const conversationSaving = useChatStore((s) => s.savingConversationLocale);
  const updateConversationLocale = useChatStore(
    (s) => s.updateConversationLocale,
  );
  const updateConversationCurrency = useChatStore(
    (s) => s.updateConversationCurrency,
  );

  const canEdit = canFetchUserScopedData(accessMode);

  useEffect(() => {
    if (!canFetchUserScopedData(accessMode)) return;
    void hydrateProfile();
  }, [accessMode, hydrateProfile]);

  const profileSource = useMemo(
    () =>
      profileLocalization
        ? {
            shippingCountry: profileLocalization.profileRaw,
            country: null as string | null,
            currency: profileLocalization.currency,
          }
        : { shippingCountry: null, country: null, currency: null },
    [profileLocalization],
  );

  const localization: CatalogLocalization | null = useMemo(() => {
    if (
      activeConversationId &&
      conversationMeta?.id === activeConversationId
    ) {
      return resolveEffectiveCatalogLocalization(profileSource, {
        shippingCountry: conversationMeta.shippingCountry,
        currency: conversationMeta.currency,
      });
    }
    return profileLocalization;
  }, [
    activeConversationId,
    conversationMeta,
    profileLocalization,
    profileSource,
  ]);

  const updateShippingCountry = async (countryCode: string) => {
    if (activeConversationId) {
      return updateConversationLocale(activeConversationId, countryCode);
    }
    return updateProfileLocale(countryCode);
  };

  const updateCurrency = async (currencyCode: string) => {
    if (activeConversationId) {
      return updateConversationCurrency(activeConversationId, currencyCode);
    }
    return updateProfileCurrency(currencyCode);
  };

  return {
    localization,
    loading: profileHydrating && !profileLocalization,
    saving: profileSaving || conversationSaving,
    canEdit,
    /** True when the top bar edits this chat only (not profile defaults). */
    isConversationScoped: Boolean(activeConversationId),
    updateShippingCountry,
    updateCurrency,
  };
}
