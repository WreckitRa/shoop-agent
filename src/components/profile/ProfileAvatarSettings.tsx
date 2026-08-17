"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { CardForgeStep } from "@/components/onboarding/CardForgeStep";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsCardHeader,
} from "@/components/profile/profile-settings-ui";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import { guestFetch } from "@/lib/client/guest-fetch";
import { useAppSessionStore } from "@/lib/client/app-session";
import { useUserProfileStore } from "@/lib/client/user-profile-store";
import type { StyleMix } from "@/lib/onboarding/style-mix";

type AvatarPerson = {
  id: string;
  relation: string;
  name: string | null;
  label: string;
  has_avatar: boolean;
  avatar_url: string | null;
};

type CardContext = {
  preferredName: string;
  styleEra: string | null;
  styleMix: StyleMix | null;
};

type AvatarFlowModalProps = {
  open: boolean;
  personId: string;
  avatarBusy: boolean;
  cardContext: CardContext;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onComplete: () => void;
};

function AvatarFlowModal({
  open,
  personId,
  avatarBusy,
  cardContext,
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
        className="relative z-10 flex max-h-[min(92vh,820px)] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-hairline bg-white shadow-[0_24px_64px_rgba(14,14,17,0.18)]"
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-neutral-400">
              Your card
            </p>
            <h2
              id="avatar-flow-title"
              className="mt-1 text-[18px] font-extrabold tracking-tight text-ink sm:text-[20px]"
            >
              Complete your card
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!avatarBusy) onClose();
            }}
            disabled={avatarBusy}
            aria-label="Close"
            className="inline-flex size-8 items-center justify-center rounded-[10px] text-ink-muted transition hover:bg-surface-tint hover:text-ink disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5 sm:px-6">
          {avatarBusy ? (
            <p className="mb-3 text-xs text-ink-muted">
              Hang tight — closing now would interrupt your card mint.
            </p>
          ) : null}

          <CardForgeStep
            key={personId}
            personId={personId}
            preferredName={cardContext.preferredName}
            styleEra={cardContext.styleEra}
            styleMix={cardContext.styleMix}
            showStepTag
            onBusyChange={onBusyChange}
            onComplete={onComplete}
            onWelcomeDone={onClose}
            onSkipAll={() => {
              void onComplete();
              onClose();
            }}
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
  const storeName = useUserProfileStore((s) => s.identity?.preferredName ?? "");

  const [selfPerson, setSelfPerson] = useState<AvatarPerson | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [cardContext, setCardContext] = useState<CardContext>({
    preferredName: storeName,
    styleEra: null,
    styleMix: null,
  });

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

  const loadCardContext = useCallback(async () => {
    try {
      const res = await guestFetch("/api/onboarding", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as {
        profile?: {
          preferredName?: string | null;
          styleEra?: string | null;
          styleMix?: StyleMix | null;
        } | null;
      };
      setCardContext({
        preferredName:
          json.profile?.preferredName?.trim() || storeName || "",
        styleEra: json.profile?.styleEra ?? null,
        styleMix: json.profile?.styleMix ?? null,
      });
    } catch {
      setCardContext((c) => ({
        ...c,
        preferredName: storeName || c.preferredName,
      }));
    }
  }, [storeName]);

  useEffect(() => {
    void loadSelf();
  }, [loadSelf]);

  useEffect(() => setMounted(true), []);

  const closeFlow = useCallback(() => setOpen(false), []);

  return (
    <>
      <SettingsCard>
        <SettingsCardHeader
          title="Your Shoop card"
          description="Mint a card of you — then preview how pieces look on your body before you buy."
        />
        {loading ? (
          <div className="px-5 py-6 sm:px-6">
            <div className="h-16 animate-pulse rounded-xl bg-surface-tint" />
          </div>
        ) : needsSignIn ? (
          <div className="px-5 py-4 text-sm text-ink-muted sm:px-6">
            Sign in to complete your card.
          </div>
        ) : !selfPerson ? (
          <div className="px-5 py-4 text-sm text-ink-muted sm:px-6">
            Finish setting up your profile first, then come back for your card.
          </div>
        ) : (
          <div className="divide-y divide-hairline-soft">
            {selfPerson.has_avatar && selfPerson.avatar_url ? (
              <div className="flex items-center gap-4 px-5 py-4 sm:px-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selfPerson.avatar_url}
                  alt="Your card portrait"
                  className="size-16 rounded-2xl object-cover ring-1 ring-hairline"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">Card minted</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    Outfits in search can preview on you. Update anytime.
                  </p>
                </div>
              </div>
            ) : null}
            <SettingsActionRow
              title={
                selfPerson.has_avatar
                  ? "Update your card"
                  : "Complete your card"
              }
              subtitle={
                selfPerson.has_avatar
                  ? "New photo or shape tweak — clarity resets, then remint."
                  : "Photo + height + build. Fog clears as you go."
              }
              onClick={() => {
                void loadCardContext();
                setOpen(true);
              }}
            />
          </div>
        )}
      </SettingsCard>

      {mounted && selfPerson ? (
        <AvatarFlowModal
          open={open}
          personId={selfPerson.id}
          avatarBusy={avatarBusy}
          cardContext={cardContext}
          onBusyChange={setAvatarBusy}
          onClose={closeFlow}
          onComplete={async () => {
            useSelfAvatarStore.getState().markReady();
            void useSelfAvatarStore.getState().refresh();
            await loadSelf();
          }}
        />
      ) : null}
    </>
  );
}
