"use client";

import { Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { AppShellProvider } from "@/components/layout/AppShellProvider";

function PageShellInner({ children }: { children: React.ReactNode }) {
  return (
    <AppShellProvider preserveConversation>
      <AppShell>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </AppShell>
    </AppShellProvider>
  );
}

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <PageShellInner>{children}</PageShellInner>
    </Suspense>
  );
}
