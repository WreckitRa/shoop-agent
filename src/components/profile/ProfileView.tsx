"use client";

import { useEffect, useMemo, useState } from "react";
import { ProfileAccountActions } from "@/components/profile/ProfileAccountActions";
import { ProfileAvatarSettings } from "@/components/profile/ProfileAvatarSettings";
import {
  ProfileHeroSkeleton,
  ProfileOptionChips,
  SettingsCard,
  SettingsCardHeader,
  SettingsCardSkeleton,
  SettingsDivider,
  SettingsField,
  SettingsInput,
  StickySaveBar,
} from "@/components/profile/profile-settings-ui";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useUserIdentity } from "@/hooks/useUserIdentity";
import { guestFetch } from "@/lib/client/guest-fetch";
import { useUserProfileStore } from "@/lib/client/user-profile-store";
import {
  AGE_RANGES,
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  GENDER_OPTIONS,
  currencyHintForCountry,
} from "@/lib/onboarding/form-options";

type ProfileData = {
  preferredName?: string | null;
  genderPresentation?: string | null;
  ageRange?: string | null;
  shippingCountry?: string | null;
  country?: string | null;
  currency?: string | null;
};

type ProfileForm = {
  preferredName: string;
  genderPresentation: string;
  ageRange: string;
  shippingCountry: string;
  currency: string;
};

function toForm(profile: ProfileData | null): ProfileForm {
  return {
    preferredName: profile?.preferredName?.trim() ?? "",
    genderPresentation: profile?.genderPresentation?.trim() ?? "",
    ageRange: profile?.ageRange?.trim() ?? "",
    shippingCountry:
      profile?.shippingCountry?.trim() ??
      profile?.country?.trim() ??
      "",
    currency: profile?.currency?.trim().toUpperCase() ?? "",
  };
}

function formsEqual(a: ProfileForm, b: ProfileForm): boolean {
  return (
    a.preferredName === b.preferredName &&
    a.genderPresentation === b.genderPresentation &&
    a.ageRange === b.ageRange &&
    a.shippingCountry === b.shippingCountry &&
    a.currency === b.currency
  );
}

function personalDirty(a: ProfileForm, b: ProfileForm): boolean {
  return (
    a.preferredName !== b.preferredName ||
    a.genderPresentation !== b.genderPresentation ||
    a.ageRange !== b.ageRange
  );
}

function localeDirty(a: ProfileForm, b: ProfileForm): boolean {
  return (
    a.shippingCountry !== b.shippingCountry || a.currency !== b.currency
  );
}

const AGE_OPTIONS = AGE_RANGES.map((a) => ({ value: a, label: a }));

export function ProfileView() {
  const { initials, email, preferredName, loading: identityLoading } =
    useUserIdentity();
  const [savedForm, setSavedForm] = useState<ProfileForm>(() =>
    toForm(preferredName ? { preferredName } : null),
  );
  const [form, setForm] = useState<ProfileForm>(savedForm);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profileRes = await guestFetch("/api/profile", { cache: "no-store" });
        if (cancelled || !profileRes.ok) return;
        const json = (await profileRes.json()) as { profile?: ProfileData };
        const row = json.profile ?? null;
        const next = toForm(row);
        setSavedForm(next);
        setForm(next);
        if (row?.preferredName !== undefined) {
          useUserProfileStore.getState().seedIdentity({
            preferredName: row.preferredName,
            email,
          });
        }
      } finally {
        if (!cancelled) setLoadingDetails(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email]);

  const dirty = useMemo(() => !formsEqual(form, savedForm), [form, savedForm]);
  const personalChanged = useMemo(
    () => personalDirty(form, savedForm),
    [form, savedForm],
  );
  const localeChanged = useMemo(
    () => localeDirty(form, savedForm),
    [form, savedForm],
  );

  const personalComplete =
    form.preferredName.trim().length > 0 &&
    form.genderPresentation.trim().length > 0 &&
    form.ageRange.trim().length > 0;

  const canSave =
    dirty &&
    ((personalChanged && personalComplete) ||
      (localeChanged && form.shippingCountry.trim().length > 0));

  const displayName =
    form.preferredName.trim() ||
    savedForm.preferredName.trim() ||
    preferredName ||
    "Your account";
  const loading = identityLoading && !preferredName;

  async function saveProfile() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    setSavedFlash(false);
    try {
      const payload: Record<string, string> = {};
      if (personalChanged) {
        payload.preferredName = form.preferredName.trim();
        payload.genderPresentation = form.genderPresentation.trim();
        payload.ageRange = form.ageRange.trim();
      }
      if (localeChanged) {
        payload.shippingCountry = form.shippingCountry.trim();
        if (form.currency.trim()) {
          payload.currency = form.currency.trim().toUpperCase();
        }
      }
      const res = await guestFetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        error?: string;
        profile?: ProfileData;
      };
      if (!res.ok) {
        setSaveError(json.error ?? "Could not save profile.");
        return;
      }
      const next = toForm(json.profile ?? { ...savedForm, ...payload });
      setSavedForm(next);
      setForm(next);
      if (personalChanged) {
        useUserProfileStore.getState().seedIdentity({
          preferredName: next.preferredName,
          email,
        });
      }
      void useUserProfileStore.getState().hydrate({ force: true });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2200);
    } catch {
      setSaveError("Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  function discardChanges() {
    setForm(savedForm);
    setSaveError(null);
    setSavedFlash(false);
  }

  function updateForm<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaveError(null);
    setSavedFlash(false);
  }

  function handleCountryChange(country: string) {
    setForm((prev) => {
      const hint =
        !prev.currency.trim() ? currencyHintForCountry(country) : null;
      return {
        ...prev,
        shippingCountry: country,
        ...(hint ? { currency: hint } : {}),
      };
    });
    setSaveError(null);
    setSavedFlash(false);
  }

  return (
    <>
      <div
        className={`mx-auto max-w-2xl space-y-6 py-6 md:py-8 ${dirty ? "pb-28" : "pb-8"}`}
      >
        {loading || loadingDetails ? (
          <ProfileHeroSkeleton />
        ) : (
          <header className="flex flex-col items-center text-center">
            <div className="relative">
              <div
                className="absolute -inset-1 rounded-full bg-gradient-to-br from-brand/20 via-transparent to-ink/5"
                aria-hidden
              />
              <div className="relative flex size-20 items-center justify-center rounded-full bg-ink text-2xl font-semibold tracking-tight text-white shadow-lift">
                {initials}
              </div>
            </div>
            <h1 className="mt-5 font-display text-2xl font-extrabold tracking-tight text-ink">
              {displayName}
            </h1>
            {email ? (
              <p className="mt-1 max-w-sm truncate text-sm text-ink-muted">
                {email}
              </p>
            ) : null}
          </header>
        )}

        {loadingDetails ? (
          <>
            <SettingsCardSkeleton />
            <SettingsCardSkeleton />
          </>
        ) : (
          <>
            <SettingsCard>
              <SettingsCardHeader
                title="Personal information"
                description="Used to personalize recommendations and how Shoop addresses you."
              />
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveProfile();
                }}
              >
                <SettingsField
                  label="Display name"
                  hint="Your first name or what you'd like to be called."
                >
                  <SettingsInput
                    value={form.preferredName}
                    onChange={(e) => updateForm("preferredName", e.target.value)}
                    autoComplete="given-name"
                    placeholder="e.g. Alex"
                    maxLength={120}
                  />
                </SettingsField>

                <SettingsDivider />

                <SettingsField
                  label="Shopping style"
                  hint="Helps us surface clothing and sizing that fit how you shop."
                >
                  <ProfileOptionChips
                    label="Shopping style"
                    value={form.genderPresentation}
                    onChange={(v) => updateForm("genderPresentation", v)}
                    options={GENDER_OPTIONS}
                  />
                </SettingsField>

                <SettingsDivider />

                <SettingsField label="Age range">
                  <ProfileOptionChips
                    label="Age range"
                    value={form.ageRange}
                    onChange={(v) => updateForm("ageRange", v)}
                    options={AGE_OPTIONS}
                  />
                </SettingsField>
              </form>
            </SettingsCard>

            <SettingsCard>
              <SettingsCardHeader
                title="Shopping region"
                description="Used for catalog shipping filters and price currency on every search. Updates your default for new chats."
              />
              <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 sm:px-6">
                <SearchableSelect
                  label="Shipping country"
                  value={form.shippingCountry}
                  onChange={handleCountryChange}
                  options={COUNTRY_OPTIONS}
                  placeholder="Search your country"
                  searchPlaceholder="Type a country name…"
                  allowCustom
                  optional
                />
                <SearchableSelect
                  label="Preferred currency"
                  value={form.currency}
                  onChange={(v) => updateForm("currency", v)}
                  options={CURRENCY_OPTIONS.map((c) => ({
                    value: c.value,
                    label: c.label,
                    hint: c.value,
                  }))}
                  placeholder="Search currency"
                  searchPlaceholder="Search for your currency…"
                  allowCustom
                  optional
                />
              </div>
            </SettingsCard>

            <ProfileAvatarSettings />

            {saveError ? (
              <p className="text-center text-xs text-error-deep">{saveError}</p>
            ) : null}

            {dirty && !canSave ? (
              <p className="text-center text-xs text-ink-muted">
                {personalChanged && !personalComplete
                  ? "Complete all personal fields before saving those changes."
                  : "Choose a shipping country before saving region changes."}
              </p>
            ) : null}
          </>
        )}

        <ProfileAccountActions />
      </div>

      <StickySaveBar
        visible={dirty}
        saving={saving}
        saved={savedFlash}
        canSave={canSave}
        onDiscard={discardChanges}
        onSave={() => void saveProfile()}
      />
    </>
  );
}
