import type { Metadata } from "next";
import { Suspense } from "react";
import { PageShell } from "@/components/layout/PageShell";
import { DecideHub } from "@/components/moodboard/DecideHub";
import { createPageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = createPageMetadata({
  title: "Moodboard",
  description:
    "My moodboard, The Hold, and My cart — looks you loved and what you're buying.",
  path: "/moodboard",
  noIndex: true,
});

export default function MoodboardPage() {
  return (
    <PageShell>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
        <Suspense fallback={null}>
          <DecideHub />
        </Suspense>
      </div>
    </PageShell>
  );
}
