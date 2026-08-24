import Link from "next/link";
import { LEGAL_NAV } from "@/lib/legal/constants";
import { cn } from "@/lib/ai-chat/cn";

export function LegalFooterLinks({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const items = compact
    ? LEGAL_NAV.filter((item) =>
        item.slug === "terms" ||
        item.slug === "privacy" ||
        item.slug === "cookies",
      )
    : LEGAL_NAV;

  return (
    <nav
      aria-label="Legal"
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] leading-5 text-ink-muted",
        className,
      )}
    >
      {items.map((item, i) => (
        <span key={item.slug} className="inline-flex items-center gap-2">
          {i > 0 ? <span aria-hidden>·</span> : null}
          <Link
            href={item.href}
            className="underline underline-offset-2 hover:text-ink"
          >
            {compact ? item.short : item.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}
