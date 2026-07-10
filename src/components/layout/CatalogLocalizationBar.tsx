"use client";

import { CatalogCountryPicker } from "@/components/layout/CatalogCountryPicker";
import { CatalogCurrencyPicker } from "@/components/layout/CatalogCurrencyPicker";
import { useCatalogLocalization } from "@/hooks/useCatalogLocalization";

/** Compact shipping region + currency controls for the top bar. */
export function CatalogLocalizationBar() {
  const {
    localization,
    loading,
    saving,
    canEdit,
    updateShippingCountry,
    updateCurrency,
  } = useCatalogLocalization();

  const disabledReason = canEdit
    ? undefined
    : "Continue as guest to set shipping and currency";

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <CatalogCountryPicker
        localization={localization}
        loading={loading}
        saving={saving}
        disabled={!canEdit}
        disabledReason={disabledReason}
        onSelect={updateShippingCountry}
      />
      <CatalogCurrencyPicker
        localization={localization}
        loading={loading}
        saving={saving}
        disabled={!canEdit}
        disabledReason={disabledReason}
        onSelect={updateCurrency}
      />
    </div>
  );
}
