import type { ReactNode } from "react";
import { cn } from "@/lib/ai-chat/cn";

export type PageLayoutVariant = "immersive" | "chat" | "document";

export function PageLayout({
  children,
  variant,
  className,
}: {
  children: ReactNode;
  variant: PageLayoutVariant;
  className?: string;
}) {
  if (variant === "immersive") {
    return (
      <div
        className={cn(
          "mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden px-0 md:max-w-[720px]",
          className,
        )}
      >
        {children}
      </div>
    );
  }

  if (variant === "chat") {
    return (
      <div className={cn("flex h-full min-h-0 w-full flex-1 flex-col", className)}>
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "min-h-[calc(100dvh-56px)] w-full bg-surface-subtle font-sans md:min-h-[calc(100dvh-64px)]",
        className,
      )}
    >
      <div className="shoop-page-x mx-auto w-full max-w-page-wide pb-10 pt-3 md:pb-12 md:pt-4">
        {children}
      </div>
    </div>
  );
}
