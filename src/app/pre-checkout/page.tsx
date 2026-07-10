import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { PreCheckoutView } from "@/components/checkout/PreCheckoutView";

export const dynamic = "force-dynamic";

export default function PreCheckoutPage() {
  return (
    <PageShell>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center py-16">
              <Loader2 className="size-8 animate-spin text-ink-muted" />
            </div>
          }
        >
          <PreCheckoutView />
        </Suspense>
      </div>
    </PageShell>
  );
}
