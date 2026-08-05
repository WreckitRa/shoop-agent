import type { Metadata } from "next";
import { PageShell } from "@/components/layout/PageShell";
import { MyAsksView } from "@/components/ask/MyAsksView";
import { createPageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = createPageMetadata({
  title: "Shared cards",
  description: "Looks you asked friends about — votes, notes, and Shoop’s take.",
  path: "/asks",
  noIndex: true,
});

export default function AsksPage() {
  return (
    <PageShell>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
        <div className="shoop-page-x mx-auto w-full max-w-page-wide py-4 md:py-5">
          <MyAsksView />
        </div>
      </div>
    </PageShell>
  );
}
