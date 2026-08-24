import Link from "next/link";
import { ShoopLogo } from "@/components/brand/ShoopBrand";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain bg-gradient-to-b from-white to-[#F7F7F9]">
      <header className="sticky top-0 z-10 border-b border-[var(--fitting-line)] bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[760px] items-center justify-between px-5 md:px-8">
          <Link href="/" aria-label="Shoop home">
            <ShoopLogo className="h-[18px]" />
          </Link>
          <Link
            href="/"
            className="text-[12px] font-extrabold tracking-[0.04em] text-[var(--fitting-quiet)] hover:text-[var(--fitting-ink)]"
          >
            Back to Shoop
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
