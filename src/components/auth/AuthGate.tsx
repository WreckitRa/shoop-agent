"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { GuestLeavePrompt } from "@/components/auth/GuestLeavePrompt";
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
  "w-full rounded-xl border border-hairline bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-ink/30 focus:ring-2 focus:ring-ink/5";

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
      leaveConversationRoute();
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
        <p className="text-sm text-ink-muted">Loading…</p>
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
        <OnboardingGate />
      </>
    );
  }

  if (guestActive) {
    return (
      <>
        {children}
        <GuestLeavePrompt />
        {showAuthModal ? (
          <AuthOverlay
            onDismiss={() => {
              setShowAuthModal(false);
              setLoginDataLossAcknowledged(false);
            }}
          >
            <AuthModal
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
          </AuthOverlay>
        ) : null}
      </>
    );
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
    <div className="flex min-h-[100dvh] items-center justify-center">
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
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4 backdrop-blur-md"
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
  /** Guest session active — show sign-in data-loss warning and signup save copy. */
  isGuestBrowsing?: boolean;
  guestHasDataToLose?: boolean;
  loginDataLossAcknowledged?: boolean;
  onLoginDataLossAcknowledgedChange?: (acknowledged: boolean) => void;
  onContinueAsGuest: () => void;
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
}: AuthModalProps) {
  const showLoginDataLossGuard =
    isGuestBrowsing && mode === "login" && guestHasDataToLose;
  const loginSubmitBlocked =
    showLoginDataLossGuard && !loginDataLossAcknowledged;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
      className="w-full max-w-md overflow-hidden rounded-[28px] border border-hairline bg-white shadow-lift"
    >
      <AuthModalHeader mode={mode} onModeChange={onModeChange} />
      {showLoginDataLossGuard ? (
        <div
          role="alert"
          className="mx-6 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm leading-snug text-amber-950"
        >
          <span className="font-medium">Heads up:</span> signing in opens your
          existing account and erases this device&apos;s guest chats, cart, and
          preferences — including anything stored locally. Clearing your browser
          cache or data will also delete your guest session. They won&apos;t be
          merged into your account.
        </div>
      ) : null}
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4 px-6 py-5">
        <label className="block space-y-2 text-sm">
          <span className="font-medium text-ink">Email</span>
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
        <label className="block space-y-2 text-sm">
          <span className="font-medium text-ink">Password</span>
          <input
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
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
              I understand my guest chats and preferences on this device will be
              erased when I sign in, and that clearing browser data will delete
              them too.
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
          className="btn-primary w-full rounded-full py-2.5"
        >
          {busy
            ? mode === "signup"
              ? "Creating account…"
              : "Signing in…"
            : mode === "signup"
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      {showGuestCta ? (
        <div className="border-t border-hairline px-6 py-4">
          <div className="relative mb-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-hairline" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
              or
            </span>
            <div className="h-px flex-1 bg-hairline" />
          </div>
          <button
            type="button"
            onClick={onContinueAsGuest}
            className={cn(
              "group flex w-full items-center justify-between gap-3 rounded-2xl border border-hairline",
              "bg-gradient-to-br from-surface-tint to-white px-4 py-3.5 text-left transition-all duration-200",
              "hover:border-ink/15 hover:shadow-soft active:scale-[0.99]",
            )}
          >
            <span className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft ring-1 ring-hairline">
                <Sparkles
                  className="h-5 w-5 text-brand"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </span>
              <span>
                <span className="block text-sm font-semibold text-ink">
                  Continue as guest
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-ink-muted">
                  Try Shoop instantly — your chats stay on this device until you sign up.
                </span>
              </span>
            </span>
            <ArrowRight
              className="h-4 w-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
              strokeWidth={1.75}
              aria-hidden
            />
          </button>
        </div>
      ) : null}

      <p className="border-t border-hairline px-6 py-4 text-center text-xs leading-relaxed text-ink-muted">
        {showGuestCta
          ? "Create an account anytime to sync chats, memory, and checkout across devices."
          : isGuestBrowsing && mode === "signup"
            ? "Sign up to save your guest session and pick up on any device."
            : isGuestBrowsing && mode === "login" && guestHasDataToLose
              ? "Sign up instead if you want to keep this guest session."
              : "Sign in to access your saved chats and preferences."}
      </p>
    </div>
  );
}

function AuthModalHeader({
  mode,
  onModeChange,
}: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
}) {
  return (
    <div className="border-b border-hairline px-6 py-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
        Account
      </p>
      <h2
        id="auth-title"
        className="mt-2 font-serif text-[1.75rem] font-semibold tracking-tight text-ink"
      >
        {mode === "signup" ? "Create your account" : "Welcome back"}
      </h2>
      <div className="mt-5 flex gap-1 rounded-full bg-surface-tint p-1">
        <button
          type="button"
          onClick={() => onModeChange("login")}
          className={cn(
            "flex-1 rounded-full px-3 py-2 text-sm font-medium transition-colors",
            mode === "login"
              ? "bg-white text-ink shadow-soft"
              : "text-ink-secondary hover:text-ink",
          )}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => onModeChange("signup")}
          className={cn(
            "flex-1 rounded-full px-3 py-2 text-sm font-medium transition-colors",
            mode === "signup"
              ? "bg-white text-ink shadow-soft"
              : "text-ink-secondary hover:text-ink",
          )}
        >
          Sign up
        </button>
      </div>
    </div>
  );
}
