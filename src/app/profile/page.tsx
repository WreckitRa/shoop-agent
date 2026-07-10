import type { Metadata } from "next";
import { PageShell } from "@/components/layout/PageShell";
import { ProfileView } from "@/components/profile/ProfileView";
import { createPageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = createPageMetadata({
  title: "Your profile",
  description:
    "Manage your Shoop shopping profile — sizes, tastes, budgets, and saved preferences.",
  path: "/profile",
  noIndex: true,
});

export default function ProfilePage() {
  return (
    <PageShell>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
        <div className="shoop-page-x mx-auto w-full max-w-page-wide py-4 md:py-5">
          <ProfileView />
        </div>
      </div>
    </PageShell>
  );
}
