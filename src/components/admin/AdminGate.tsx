"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import {
  ADMIN_TOKEN_HEADER,
  ADMIN_TOKEN_STORAGE_KEY,
} from "@/lib/admin/auth";

export function AdminGate({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  const verifyToken = useCallback(async (value: string) => {
    const res = await fetch("/api/admin/fashion/runs?limit=1", {
      headers: { [ADMIN_TOKEN_HEADER]: value },
    });
    if (res.status === 403 || res.status === 503) return false;
    return res.ok;
  }, []);

  useEffect(() => {
    void (async () => {
      const stored = sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
      if (stored && (await verifyToken(stored))) {
        setToken(stored);
      }
      setChecking(false);
    })();
  }, [verifyToken]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = draft.trim();
    if (!value) return;
    const ok = await verifyToken(value);
    if (!ok) {
      setError("Invalid admin token or admin is not configured on the server.");
      return;
    }
    sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, value);
    setToken(value);
  }

  if (checking) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-ink-muted">
        Checking admin access…
      </div>
    );
  }

  if (!token) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center px-4">
        <div className="card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <ShieldCheck className="size-5" strokeWidth={2} />
            </span>
            <div>
              <h1 className="text-lg font-semibold text-ink">Shoop Admin</h1>
              <p className="text-xs text-ink-muted">Fashion funnel observability</p>
            </div>
          </div>
          <form onSubmit={(e) => void submit(e)} className="space-y-3">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-ink">Admin token</span>
              <input
                type="password"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="input w-full font-mono text-sm"
                placeholder="AI_CHAT_ADMIN_TOKEN"
                autoComplete="off"
              />
            </label>
            {error ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn-primary w-full">
              Unlock admin
            </button>
          </form>
          <p className="mt-4 text-xs leading-relaxed text-ink-muted">
            Set <code className="rounded bg-surface-subtle px-1">AI_CHAT_ADMIN_TOKEN</code> in
            the server environment. The token is stored in this browser session only.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function useAdminToken(): string | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    setToken(sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY));
  }, []);
  return token;
}

export function adminFetch(path: string, token: string, init?: RequestInit) {
  return fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      [ADMIN_TOKEN_HEADER]: token,
    },
  });
}
