"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsCardHeader,
} from "@/components/profile/profile-settings-ui";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import { profileSettingsAccess } from "@/components/profile/profile-settings-access";
import { guestFetch } from "@/lib/client/guest-fetch";
import { useAppSessionStore } from "@/lib/client/app-session";

type AvatarPerson = {
  id: string;
  relation: string;
  name: string | null;
  label: string;
  has_avatar: boolean;
  avatar_url: string | null;
};

export function ProfileAvatarSettings() {
  const accessMode = useAppSessionStore((s) => s.mode);
  const needsSignIn = !profileSettingsAccess(accessMode).showTwinSettings;

  const [selfPerson, setSelfPerson] = useState<AvatarPerson | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSelf = useCallback(async () => {
    if (needsSignIn) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await guestFetch("/api/avatar/people", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { people?: AvatarPerson[] };
      const rows = json.people ?? [];
      const self = rows.find((p) => p.relation === "self") ?? rows[0] ?? null;
      setSelfPerson(self);
      void useSelfAvatarStore.getState().refresh();
    } finally {
      setLoading(false);
    }
  }, [needsSignIn]);

  useEffect(() => {
    void loadSelf();
  }, [loadSelf]);

  return (
    <SettingsCard>
      <SettingsCardHeader
        title="Your twin"
        description="The Fitting builds a body double so finds can preview on you before you buy."
      />
      {loading ? (
        <div className="px-5 py-6 sm:px-6">
          <div className="h-16 animate-pulse rounded-xl bg-surface-tint" />
        </div>
      ) : needsSignIn ? (
        <div className="px-5 py-4 text-sm text-ink-muted sm:px-6">
          Sign in to create your twin.
        </div>
      ) : !selfPerson ? (
        <div className="px-5 py-4 text-sm text-ink-muted sm:px-6">
          Finish setting up your profile first, then come back for your twin.
        </div>
      ) : (
        <div className="divide-y divide-hairline-soft">
          {selfPerson.has_avatar && selfPerson.avatar_url ? (
            <div className="flex items-center gap-4 px-5 py-4 sm:px-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selfPerson.avatar_url}
                alt="Your twin"
                className="size-16 rounded-2xl object-cover ring-1 ring-hairline"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">Twin ready</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Outfits in search can preview on you. Update anytime.
                </p>
              </div>
            </div>
          ) : null}
          <SettingsActionRow
            title={
              selfPerson.has_avatar ? "Update your twin" : "Create your twin"
            }
            subtitle={
              selfPerson.has_avatar
                ? "Opens The Fitting — new photo or shape, then remint."
                : "Opens The Fitting — photo, height, and build."
            }
            onClick={() => useSelfAvatarStore.getState().openCreateFlow()}
          />
        </div>
      )}
    </SettingsCard>
  );
}
