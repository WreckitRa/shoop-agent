"use client";

import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";

export const OptionPreviewCarousel = memo(function OptionPreviewCarousel({
  title = "Explore ideas",
  bare = false,
  children,
  className,
}: {
  title?: string;
  /** Hide header — wireframe quiz rows have no “Explore ideas” chrome */
  bare?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(maxScroll > 4 && el.scrollLeft < maxScroll - 4);
  };

  useEffect(() => {
    updateScrollState();
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    const mo = new MutationObserver(updateScrollState);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  const scrollByPage = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>(".shoop-explore-card");
    const gap = 12;
    const step = (card?.offsetWidth ?? 96) + gap;
    el.scrollBy({ left: direction * step, behavior: "smooth" });
  };

  return (
    <section
      className={cn(
        "shoop-explore-section",
        bare && "shoop-explore-section--bare",
        className,
      )}
    >
      {!bare ? (
        <div className="shoop-explore-section__header">
          <h2 className="shoop-explore-section__title">{title}</h2>
          <div className="shoop-explore-section__nav">
            <button
              type="button"
              aria-label="Previous page"
              disabled={!canScrollLeft}
              onClick={() => scrollByPage(-1)}
              className="shoop-explore-nav-btn"
            >
              <ChevronLeft className="size-4" strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Next page"
              disabled={!canScrollRight}
              onClick={() => scrollByPage(1)}
              className="shoop-explore-nav-btn"
            >
              <ChevronRight className="size-4" strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      <div className="shoop-explore-track-wrap">
        <div
          ref={scrollerRef}
          className="shoop-explore-track"
          onScroll={updateScrollState}
          style={{ touchAction: "pan-x pinch-zoom" }}
        >
          {children}
        </div>
      </div>
    </section>
  );
});
