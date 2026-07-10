"use client";

import { ADMIN_TOKEN_STORAGE_KEY } from "@/lib/admin/auth";

export function AdminSignOut() {
  return (
    <button
      type="button"
      className="text-xs font-medium text-ink-muted transition hover:text-brand"
      onClick={() => {
        sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
        window.location.href = "/admin/fashion";
      }}
    >
      Lock admin
    </button>
  );
}
