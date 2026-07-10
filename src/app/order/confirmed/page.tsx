import { PageShell } from "@/components/layout/PageShell";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";

type Props = {
  searchParams: Promise<{ id?: string }>;
};

export default async function OrderConfirmedPage({ searchParams }: Props) {
  const { id } = await searchParams;
  const orderRef = id?.trim() || null;

  return (
    <PageShell>
      <div className="flex flex-1 items-center justify-center shoop-page-x py-12">
        <div className="max-w-md rounded-[28px] border border-hairline bg-white p-8 text-center shadow-card">
          <CheckCircle2 className="mx-auto size-12 text-success" />
          <h1 className="mt-4 font-serif text-3xl font-semibold tracking-tight text-ink">
            Order confirmed
          </h1>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">
            Thank you for your purchase. Confirmation and tracking details will be sent to
            your email.
          </p>
          {orderRef ? (
            <p className="mt-4 break-all rounded-xl bg-surface-tint px-3 py-2 font-mono text-xs text-ink-secondary">
              {orderRef}
            </p>
          ) : null}
          <Link
            href="/"
            className="btn-primary mt-6 inline-flex"
          >
            Continue shopping
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
