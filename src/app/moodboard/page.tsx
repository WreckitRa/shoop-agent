import type { Metadata } from "next";
import { PageShell } from "@/components/layout/PageShell";
import { MoodboardView } from "@/components/moodboard/MoodboardView";
import { createPageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = createPageMetadata({
  title: "Moodboard",
  description: "Looks you loved — try-ons saved from your fitting room.",
  path: "/moodboard",
  noIndex: true,
});

export default function MoodboardPage() {
  return (
    <PageShell>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
        <div className="shoop-page-x mx-auto w-full max-w-page-wide py-4 md:py-5">
          <MoodboardView />
        </div>
      </div>
    </PageShell>
  );
}
