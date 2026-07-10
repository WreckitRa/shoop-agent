import { SHOOP_ICON_SRC, SHOOP_LOGO_SRC } from "@/lib/shared/brand-assets";
import { cn } from "@/lib/ai-chat/cn";

export function ShoopIcon({
  className,
  size = 27,
}: {
  className?: string;
  size?: number;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SHOOP_ICON_SRC}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 rounded-[6px]", className)}
    />
  );
}

export function ShoopLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SHOOP_LOGO_SRC}
      alt="Shoop"
      width={88}
      height={24}
      className={cn("h-5 w-auto max-w-[120px] shrink-0", className)}
    />
  );
}

function ShoopBetaTag({ className }: { className?: string }) {
  return (
    <em
      className={cn(
        "font-mono text-[0.72em] font-normal italic leading-none text-brand",
        className,
      )}
    >
      beta
    </em>
  );
}

export function ShoopSidebarBrand({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 select-none",
        className,
      )}
      aria-label="Shoop beta"
    >
      <ShoopLogo className="h-[22px]" />
      <ShoopBetaTag className="text-ink-muted" />
    </span>
  );
}

export function ShoopWelcomeBeta({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "mb-4 text-center text-sm font-medium tracking-[-0.01em] text-ink-muted md:mb-5 md:text-[15px]",
        className,
      )}
    >
      Welcome to Shoop <ShoopBetaTag className="text-[1em]" />
    </p>
  );
}
