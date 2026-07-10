"use client";

import { useCallback, useEffect, useState } from "react";
import { LogOut, Trash2, User } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import { prepareClientForSignedOut } from "@/lib/client/identity-sync";

type AuthUser = { id: string; email: string | null };

export function UserAccountMenu() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"menu" | "erase" | "delete">("menu");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/auth/session", { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as {
      configured?: boolean;
      user: AuthUser | null;
    };
    if (json.configured === false) {
      setUser(null);
      return;
    }
    setUser(json.user);
  }, []);

  useEffect(() => {
    void refresh();
    const onAuthChanged = () => void refresh();
    window.addEventListener("shoop-auth-changed", onAuthChanged);
    return () => window.removeEventListener("shoop-auth-changed", onAuthChanged);
  }, [refresh]);

  async function logout() {
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setOpen(false);
      setUser(null);
      await prepareClientForSignedOut();
      window.dispatchEvent(new Event("shoop-auth-changed"));
    } catch {
      setError("Could not sign out.");
    } finally {
      setBusy(false);
    }
  }

  async function eraseData() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eraseDataOnly: true, password }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not erase data.");
        return;
      }
      setOpen(false);
      setPanel("menu");
      setPassword("");
      window.location.reload();
    } catch {
      setError("Could not erase data.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eraseDataOnly: false, password }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not delete account.");
        return;
      }
      setOpen(false);
      window.dispatchEvent(new Event("shoop-auth-changed"));
    } catch {
      setError("Could not delete account.");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setPanel("menu");
          setError(null);
        }}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-ink-muted hover:bg-surface-tint hover:text-brand"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <User className="size-4" />
        <span className="hidden max-w-[120px] truncate sm:inline">
          {user.email ?? "Account"}
        </span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close account menu"
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border border-neutral-200 bg-white p-3 shadow-xl"
          >
            {panel === "menu" ? (
              <MenuPanel
                email={user.email}
                busy={busy}
                onLogout={() => void logout()}
                onErase={() => {
                  setPanel("erase");
                  setPassword("");
                  setError(null);
                }}
                onDelete={() => {
                  setPanel("delete");
                  setPassword("");
                  setError(null);
                }}
              />
            ) : (
              <ConfirmPanel
                title={
                  panel === "erase"
                    ? "Erase all your data?"
                    : "Delete your account?"
                }
                description={
                  panel === "erase"
                    ? "Removes chats, memory, cart, and profile data. Your login stays active."
                    : "Permanently deletes your login and all associated data. This cannot be undone."
                }
                password={password}
                onPasswordChange={setPassword}
                busy={busy}
                error={error}
                confirmLabel={panel === "erase" ? "Erase data" : "Delete account"}
                onBack={() => {
                  setPanel("menu");
                  setError(null);
                }}
                onConfirm={() =>
                  void (panel === "erase" ? eraseData() : deleteAccount())
                }
              />
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MenuPanel({
  email,
  busy,
  onLogout,
  onErase,
  onDelete,
}: {
  email: string | null;
  busy: boolean;
  onLogout: () => void;
  onErase: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <p className="truncate px-2 pb-2 text-xs text-neutral-500">{email}</p>
      <button
        type="button"
        role="menuitem"
        disabled={busy}
        onClick={onLogout}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
      >
        <LogOut className="size-4" />
        Sign out
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onErase}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-amber-900 hover:bg-amber-50"
      >
        <Trash2 className="size-4" />
        Erase all my data
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onDelete}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-red-700 hover:bg-red-50"
      >
        <Trash2 className="size-4" />
        Delete account
      </button>
    </>
  );
}

function ConfirmPanel({
  title,
  description,
  password,
  onPasswordChange,
  busy,
  error,
  confirmLabel,
  onBack,
  onConfirm,
}: {
  title: string;
  description: string;
  password: string;
  onPasswordChange: (v: string) => void;
  busy: boolean;
  error: string | null;
  confirmLabel: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-neutral-900">{title}</p>
        <p className="mt-1 text-xs leading-5 text-neutral-600">{description}</p>
      </div>
      <input
        type="password"
        autoComplete="current-password"
        placeholder="Your password"
        value={password}
        onChange={(e) => onPasswordChange(e.target.value)}
        className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none ring-neutral-400/30 focus:ring-2"
      />
      {error ? (
        <p className="text-xs text-red-700">{error}</p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="flex-1 rounded-full border border-neutral-300 px-3 py-2 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || !password.trim()}
          className={cn(
            "flex-1 rounded-full px-3 py-2 text-xs font-medium text-white disabled:opacity-50",
            confirmLabel.includes("Delete")
              ? "bg-red-700 hover:bg-red-800"
              : "bg-amber-800 hover:bg-amber-900",
          )}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </div>
  );
}
