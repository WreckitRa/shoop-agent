import Link from "next/link";
import { AdminGate } from "@/components/admin/AdminGate";
import { AdminSignOut } from "@/components/admin/AdminSignOut";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGate>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-hairline bg-page/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <div className="flex items-center gap-6">
              <Link href="/admin/fashion" className="text-sm font-bold tracking-tight text-ink">
                Shoop <span className="font-normal text-ink-muted">Admin</span>
              </Link>
              <nav className="hidden items-center gap-4 text-sm sm:flex">
                <Link
                  href="/admin/fashion"
                  className="font-medium text-brand hover:underline"
                >
                  Fashion funnel
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <AdminSignOut />
              <Link
                href="/"
                className="text-xs font-medium text-ink-muted transition hover:text-brand"
              >
                Back to chat
              </Link>
            </div>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-4 py-8">{children}</div>
        </main>
      </div>
    </AdminGate>
  );
}
