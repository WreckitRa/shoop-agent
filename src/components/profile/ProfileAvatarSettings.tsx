"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsCardHeader,
} from "@/components/profile/profile-settings-ui";
import { AvatarStepper } from "@/components/tryon/AvatarStepper";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
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

type AvatarFlowModalProps = {
  open: boolean;
  personId: string;
  avatarBusy: boolean;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onComplete: () => void;
};

function AvatarFlowModal({
  open,
  personId,
  avatarBusy,
  onBusyChange,
  onClose,
  onComplete,
}: AvatarFlowModalProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !avatarBusy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, avatarBusy, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-ink/45 backdrop-blur-md"
        onClick={() => {
          if (!avatarBusy) onClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-flow-title"
        className="relative z-10 flex max-h-[min(92vh,760px)] w-full max-w-lg flex-col overflow-hidden rounded-[28px] border border-hairline bg-white shadow-[0_24px_64px_rgba(12,12,12,0.18)]"
      >
        <div className="flex items-center justify-between border-b border-hairline-soft px-5 py-4 sm:px-6">
          <h2
            id="avatar-flow-title"
            className="font-serif text-lg font-semibold text-ink"
          >
            Create your avatar
          </h2>
          <button
            type="button"
            onClick={() => {
              if (!avatarBusy) onClose();
            }}
            disabled={avatarBusy}
            aria-label="Close"
            className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted transition hover:bg-surface-subtle hover:text-ink disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5 sm:px-6">
          {avatarBusy ? (
            <p className="mb-3 text-xs text-ink-muted">
              Hang tight — closing now would interrupt your avatar.
            </p>
          ) : null}

          <AvatarStepper
            key={personId}
            personId={personId}
            personLabel="You"
            onBusyChange={onBusyChange}
            onComplete={onComplete}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ProfileAvatarSettings() {
  const accessMode = useAppSessionStore((s) => s.mode);
  const isGuest = accessMode === "guest";
  const isAnonymous = accessMode === "anonymous";
  const needsSignIn = isGuest || isAnonymous;

  const [selfPerson, setSelfPerson] = useState<AvatarPerson | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

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
      // Keep curation try-on CTAs in sync with profile-side avatar changes.
      void useSelfAvatarStore.getState().refresh();
    } finally {
      setLoading(false);
    }
  }, [needsSignIn]);

  useEffect(() => {
    void loadSelf();
  }, [loadSelf]);

  useEffect(() => setMounted(true), []);

  const closeFlow = useCallback(() => setOpen(false), []);

  return (
    <>
      <SettingsCard>
        <SettingsCardHeader
          title="Your try-on avatar"
          description="Build a digital twin of you — then preview how pieces look before you buy."
        />
        {loading ? (
          <div className="px-5 py-6 sm:px-6">
            <div className="h-16 animate-pulse rounded-xl bg-surface-tint" />
          </div>
        ) : needsSignIn ? (
          <div className="px-5 py-4 text-sm text-ink-muted sm:px-6">
            Sign in to create your try-on avatar.
          </div>
        ) : !selfPerson ? (
          <div className="px-5 py-4 text-sm text-ink-muted sm:px-6">
            Finish setting up your profile first, then come back for your avatar.
          </div>
        ) : (
          <div className="divide-y divide-hairline-soft">
            {selfPerson.has_avatar && selfPerson.avatar_url ? (
              <div className="flex items-center gap-4 px-5 py-4 sm:px-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selfPerson.avatar_url}
                  alt="Your avatar"
                  className="size-16 rounded-2xl object-cover ring-1 ring-hairline"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">Avatar ready</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    Outfits in search can preview on you. Update anytime.
                  </p>
                </div>
              </div>
            ) : null}
            <SettingsActionRow
              title={
                selfPerson.has_avatar
                  ? "Update your avatar"
                  : "Create your avatar"
              }
              subtitle={
                selfPerson.has_avatar
                  ? "New photo or shape tweak — takes about a minute."
                  : "Clear selfie + a few quick picks. Fun, fast, honest."
              }
              onClick={() => setOpen(true)}
            />
          </div>
        )}
      </SettingsCard>

      {mounted && selfPerson ? (
        <AvatarFlowModal
          open={open}
          personId={selfPerson.id}
          avatarBusy={avatarBusy}
          onBusyChange={setAvatarBusy}
          onClose={closeFlow}
          onComplete={() => {
            closeFlow();
            void loadSelf();
          }}
        />
      ) : null}
    </>
  );
}
