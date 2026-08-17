"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { FittingMirror } from "@/components/onboarding/fitting/FittingMirror";
import { EMPTY_MIRROR } from "@/components/onboarding/fitting/types";
import { useInlineFittingStore } from "@/components/onboarding/inline-fitting-store";
import { useInlineFittingSlots } from "@/components/onboarding/useInlineFittingSlot";
import { GuestLeavePrompt } from "@/components/auth/GuestLeavePrompt";
import { ShoopLogo } from "@/components/brand/ShoopBrand";
import { flushGuestChatStateForMigration } from "@/components/chat/chat-store";
import { cn } from "@/lib/ai-chat/cn";
import {
  clearGuestSession,
  exportGuestDataForMigration,
  isGuestSessionActive,
  startGuestSessionAsync,
} from "@/lib/client/guest-storage";
import { leaveConversationRoute } from "@/lib/client/chat-navigation";
import { useAppSessionStore } from "@/lib/client/app-session";
import { queueClientIdentityResync } from "@/lib/client/identity-sync";
import { useGuestHasPersistedData } from "@/hooks/useGuestMode";

type AuthUser = { id: string; email: string | null };

type AuthMode = "login" | "signup";

const inputClassName =
  "w-full border-0 border-b-[3px] border-[var(--fitting-ink)] bg-transparent py-2 font-display text-[20px] font-bold text-[var(--fitting-ink)] outline-none placeholder:font-bold placeholder:text-[#D9D9DE] focus:border-[var(--fitting-red)]";

async function fetchSession(): Promise<{
  configured: boolean;
  user: AuthUser | null;
} | null> {
  try {
    const res = await fetch("/api/auth/session", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as { configured: boolean; user: AuthUser | null };
  } catch {
    return null;
  }
}

let authGateSessionBootstrapped = false;

async function migrateGuestDataAfterAuth(): Promise<boolean> {
  flushGuestChatStateForMigration();
  const payload = exportGuestDataForMigration();
  if (!payload) return true;

  try {
    const res = await fetch("/api/auth/migrate-guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("[shoop] guest migration failed", await res.text());
      return false;
    }
    clearGuestSession();
    return true;
  } catch (error) {
    console.error("[shoop] guest migration failed", error);
    return false;
  }
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAskPage = pathname?.startsWith("/ask/") ?? false;
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [guestActive, setGuestActive] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginDataLossAcknowledged, setLoginDataLossAcknowledged] =
    useState(false);
  const guestHasDataToLose = useGuestHasPersistedData(
    showAuthModal && guestActive,
  );
  const askGuestBootRef = useRef(false);
  const fittingColumnOpen = useInlineFittingStore((s) => s.columnOpen);
  const { questions: inlineSlot, card: cardSlot } = useInlineFittingSlots();

  const refreshGuest = useCallback(() => {
    setGuestActive(isGuestSessionActive());
  }, []);

  const refresh = useCallback(async () => {
    const session = await fetchSession();
    if (!session) return null;
    setConfigured(session.configured);
    setUser(session.user);
    refreshGuest();
    useAppSessionStore.getState().syncFromAuth({
      authConfigured: session.configured,
      user: session.user,
    });
    return session;
  }, [refreshGuest]);

  const bootstrappedRef = useRef(authGateSessionBootstrapped);

  useEffect(() => {
    void (async () => {
      try {
        if (!bootstrappedRef.current) {
          useAppSessionStore.getState().setLoading();
        }
        refreshGuest();
        const session = await refresh();
        if (!session) {
          setError("Could not check sign-in status.");
          useAppSessionStore.getState().syncFromAuth({
            authConfigured: true,
            user: null,
          });
        }
        bootstrappedRef.current = true;
        authGateSessionBootstrapped = true;
      } catch {
        setError("Could not check sign-in status.");
        useAppSessionStore.getState().syncFromAuth({
          authConfigured: true,
          user: null,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh, refreshGuest]);

  useEffect(() => {
    const onAuthChanged = () => {
      void refresh();
    };
    const onGuestChanged = () => {
      void refresh();
    };
    const onOpenAuth = (e: Event) => {
      const detail = (e as CustomEvent<{ mode?: AuthMode }>).detail;
      setMode(detail?.mode ?? "signup");
      setLoginDataLossAcknowledged(false);
      setShowAuthModal(true);
      setError(null);
    };

    window.addEventListener("shoop-auth-changed", onAuthChanged);
    window.addEventListener("shoop-guest-changed", onGuestChanged);
    window.addEventListener("shoop-open-auth", onOpenAuth);
    return () => {
      window.removeEventListener("shoop-auth-changed", onAuthChanged);
      window.removeEventListener("shoop-guest-changed", onGuestChanged);
      window.removeEventListener("shoop-open-auth", onOpenAuth);
    };
  }, [refresh, refreshGuest]);

  const prevColumnOpen = useRef(fittingColumnOpen);
  useLayoutEffect(() => {
    if (prevColumnOpen.current && !fittingColumnOpen) {
      setShowAuthModal(false);
      setLoginDataLossAcknowledged(false);
    }
    prevColumnOpen.current = fittingColumnOpen;
  }, [fittingColumnOpen]);

  // Public Ask-your-friends pages: silent guest — never block on auth modal.
  useEffect(() => {
    if (!isAskPage || user || guestActive || loading) return;
    if (askGuestBootRef.current) return;
    askGuestBootRef.current = true;
    useAppSessionStore.getState().setGuest();
    void startGuestSessionAsync().then(() => {
      setGuestActive(true);
      setError(null);
    });
  }, [isAskPage, user, guestActive, loading]);

  function handleContinueAsGuest() {
    leaveConversationRoute();
    useAppSessionStore.getState().setGuest();
    void startGuestSessionAsync().then(() => {
      setGuestActive(true);
      setShowAuthModal(false);
      setLoginDataLossAcknowledged(false);
      setError(null);
    });
  }

  function handleAuthModeChange(next: AuthMode) {
    setMode(next);
    setLoginDataLossAcknowledged(false);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (
      mode === "login" &&
      guestHasDataToLose &&
      !loginDataLossAcknowledged
    ) {
      setError("Please confirm you understand your guest data will be erased.");
      return;
    }
    setBusy(true);
    try {
      const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const body = { email, password };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string; user?: AuthUser };
      if (!res.ok) {
        setError(json.error ?? "Something went wrong.");
        return;
      }

      if (mode === "signup") {
        await migrateGuestDataAfterAuth();
      } else if (isGuestSessionActive()) {
        clearGuestSession();
      }

      refreshGuest();
      setUser(json.user ?? null);
      useAppSessionStore.getState().syncFromAuth({
        authConfigured: true,
        user: json.user ?? null,
      });
      await queueClientIdentityResync("auth", { force: true });
      if (!useInlineFittingStore.getState().columnOpen) {
        leaveConversationRoute();
      }
      setShowAuthModal(false);
      setLoginDataLossAcknowledged(false);
      setPassword("");
      window.dispatchEvent(new Event("shoop-auth-changed"));
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <AuthShell>
        <p className="text-sm font-semibold text-[var(--fitting-quiet)]">
          Loading…
        </p>
      </AuthShell>
    );
  }

  if (!configured) {
    return <>{children}</>;
  }

  if (user) {
    return (
      <>
        {children}
        {!isAskPage ? <OnboardingGate /> : null}
      </>
    );
  }

  if (guestActive) {
    const authForm = showAuthModal ? (
      <AuthModal
        layout={inlineSlot ? "column" : "overlay"}
        mode={mode}
        onModeChange={handleAuthModeChange}
        email={email}
        password={password}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        error={error}
        busy={busy}
        onSubmit={submit}
        showGuestCta={false}
        isGuestBrowsing
        guestHasDataToLose={guestHasDataToLose}
        loginDataLossAcknowledged={loginDataLossAcknowledged}
        onLoginDataLossAcknowledgedChange={setLoginDataLossAcknowledged}
        onContinueAsGuest={handleContinueAsGuest}
      />
    ) : null;

    return (
      <>
        {children}
        {!isAskPage ? <GuestLeavePrompt /> : null}
        {authForm && inlineSlot
          ? createPortal(authForm, inlineSlot)
          : authForm ? (
              <AuthOverlay
                onDismiss={() => {
                  setShowAuthModal(false);
                  setLoginDataLossAcknowledged(false);
                }}
              >
                {authForm}
              </AuthOverlay>
            ) : null}
        {authForm && cardSlot
          ? createPortal(
              <FittingMirror layout="column" mirror={EMPTY_MIRROR} />,
              cardSlot,
            )
          : null}
      </>
    );
  }

  if (isAskPage) {
    return <>{children}</>;
  }

  return (
    <AuthOverlay>
      <AuthModal
        mode={mode}
        onModeChange={setMode}
        email={email}
        password={password}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        error={error}
        busy={busy}
        onSubmit={submit}
        showGuestCta
        onContinueAsGuest={handleContinueAsGuest}
      />
    </AuthOverlay>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-b from-white to-[#F7F7F9]">
      {children}
    </div>
  );
}

function AuthOverlay({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-[rgba(14,14,17,0.45)] p-4 backdrop-blur-md"
      onClick={onDismiss ? () => onDismiss() : undefined}
      role={onDismiss ? "presentation" : undefined}
    >
      <div onClick={onDismiss ? (e) => e.stopPropagation() : undefined}>
        {children}
      </div>
    </div>
  );
}

type AuthModalProps = {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  email: string;
  password: string;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  error: string | null;
  busy: boolean;
  onSubmit: (e: React.FormEvent) => void;
  showGuestCta: boolean;
  isGuestBrowsing?: boolean;
  guestHasDataToLose?: boolean;
  loginDataLossAcknowledged?: boolean;
  onLoginDataLossAcknowledgedChange?: (acknowledged: boolean) => void;
  onContinueAsGuest: () => void;
  layout?: "overlay" | "column";
};

function AuthModal({
  mode,
  onModeChange,
  email,
  password,
  onEmailChange,
  onPasswordChange,
  error,
  busy,
  onSubmit,
  showGuestCta,
  isGuestBrowsing = false,
  guestHasDataToLose = false,
  loginDataLossAcknowledged = false,
  onLoginDataLossAcknowledgedChange,
  onContinueAsGuest,
  layout = "overlay",
}: AuthModalProps) {
  const showLoginDataLossGuard =
    isGuestBrowsing && mode === "login" && guestHasDataToLose;
  const loginSubmitBlocked =
    showLoginDataLossGuard && !loginDataLossAcknowledged;
  const column = layout === "column";

  return (
    <div
      role={column ? "region" : "dialog"}
      aria-modal={column ? undefined : true}
      aria-labelledby="auth-title"
      className={
        column
          ? "flex h-full min-h-0 flex-col overflow-y-auto bg-gradient-to-b from-white to-[#F7F7F9]"
          : "w-full max-w-md overflow-hidden rounded-[22px] border border-[var(--fitting-line)] bg-white shadow-[0_26px_54px_-22px_rgba(14,14,17,0.45)]"
      }
    >
      <div className={cn("border-b border-[var(--fitting-line)]", column ? "px-4 py-4 pr-12" : "px-7 py-6")} >
        <div className={cn("mb-4", column && "mb-3")}>
          <ShoopLogo className={column ? "h-5" : "h-6"} />
        </div>
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-[var(--fitting-red)]">
          {mode === "signup" ? "THE FITTING · START" : "WELCOME BACK"}
        </p>
        <h2
          id="auth-title"
          className={cn(
            "mt-2 font-display font-extrabold leading-[1.05] tracking-[-0.02em] text-[var(--fitting-ink)]",
            column
              ? "text-[clamp(24px,3vw,30px)]"
              : "text-[clamp(28px,4vw,34px)]",
          )}
        >
          {mode === "signup" ? "Claim your print." : "Unlock your print."}
        </h2>
        <p className="mt-2 font-whisper text-[15px] italic text-[var(--fitting-quiet)]">
          {mode === "signup"
            ? "Seven quick questions. Your twin develops while you answer."
            : "Pick up where you left off — memory, chats, and fit intact."}
        </p>
        <div className={cn("mt-5 inline-flex overflow-hidden rounded-xl border border-[#D6D6DE] bg-white", column && "mt-4")}>
          <button
            type="button"
            onClick={() => onModeChange("login")}
            className={cn(
              "px-5 py-2.5 text-xs font-extrabold transition",
              mode === "login"
                ? "bg-[var(--fitting-ink)] text-white"
                : "text-[var(--fitting-quiet)]",
            )}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => onModeChange("signup")}
            className={cn(
              "px-5 py-2.5 text-xs font-extrabold transition",
              mode === "signup"
                ? "bg-[var(--fitting-ink)] text-white"
                : "text-[var(--fitting-quiet)]",
            )}
          >
            Sign up
          </button>
        </div>
      </div>

      {showLoginDataLossGuard ? (
        <div
          role="alert"
          className={cn("mx-7 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm leading-snug text-amber-950", column && "mx-4")}
        >
          <span className="font-medium">Heads up:</span> signing in opens your
          existing account and erases this device&apos;s guest chats, cart, and
          preferences — including anything stored locally.
        </div>
      ) : null}

      <form onSubmit={(e) => void onSubmit(e)} className={cn("space-y-5 px-7 py-6", column && "space-y-4 px-4 py-4")}>
        <label className="block space-y-2">
          <span className="text-[12.5px] font-extrabold text-[var(--fitting-ink)]">
            Email
          </span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            className={inputClassName}
            placeholder="you@example.com"
          />
        </label>
        <label className="block space-y-2">
          <span className="text-[12.5px] font-extrabold text-[var(--fitting-ink)]">
            Password
          </span>
          <input
            type="password"
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            required
            minLength={8}
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            className={inputClassName}
            placeholder="At least 8 characters"
          />
        </label>
        {showLoginDataLossGuard ? (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/60 px-3.5 py-3 text-sm leading-snug text-amber-950">
            <input
              type="checkbox"
              checked={loginDataLossAcknowledged}
              onChange={(e) =>
                onLoginDataLossAcknowledgedChange?.(e.target.checked)
              }
              className="mt-0.5 size-4 shrink-0 rounded border-amber-300 text-amber-800 focus:ring-amber-400/40"
            />
            <span>
              I understand my guest chats and preferences on this device will
              be erased when I sign in.
            </span>
          </label>
        ) : null}
        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || loginSubmitBlocked}
          className={cn(
            "group inline-flex h-14 w-full items-center justify-center gap-3 rounded-[14px] bg-[var(--fitting-ink)] font-display text-[14.5px] font-extrabold text-white transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_26px_-10px_rgba(228,40,49,0.6)] disabled:opacity-50",
            column && "h-12",
          )}
        >
          {busy
            ? mode === "signup"
              ? "Creating…"
              : "Signing in…"
            : mode === "signup"
              ? "Lock it in"
              : "Sign in"}
          {!busy ? (
            <span className="transition-transform group-hover:translate-x-1">
              →
            </span>
          ) : null}
        </button>
      </form>

      {showGuestCta ? (
        <div className={cn("border-t border-[var(--fitting-line)] px-7 py-5", column && "px-4 py-4")}>
          <button
            type="button"
            onClick={onContinueAsGuest}
            className="w-full border-0 border-b border-[var(--fitting-line)] bg-transparent pb-1 text-center text-[12.5px] font-semibold text-[var(--fitting-quiet)] hover:text-[var(--fitting-ink)]"
          >
            skip... continue as guest
          </button>
          <p className="mt-3 text-center text-[11px] leading-relaxed text-[var(--fitting-quiet)]">
            Guest chats stay on this device until you claim a print.
          </p>
        </div>
      ) : (
        <p className={cn("border-t border-[var(--fitting-line)] px-7 py-4 text-center text-[11px] leading-relaxed text-[var(--fitting-quiet)]", column && "px-4 py-3")}>
          {isGuestBrowsing && mode === "signup"
            ? "Sign up to save your guest session and pick up on any device."
            : isGuestBrowsing && mode === "login" && guestHasDataToLose
              ? "Sign up instead if you want to keep this guest session."
              : "Sign in to access your saved chats and preferences."}
        </p>
      )}
    </div>
  );
}
