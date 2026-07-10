"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/ai-chat/cn";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PackageSearch,
  Sparkles,
} from "lucide-react";
import { InlineChatProductPanel } from "@/components/chat/InlineChatProductPanel";
import { SimilarPickSelectionBar } from "@/components/chat/SimilarPickSelectionBar";
import { useChatMessageProductLink } from "@/components/chat/ChatMessageProductLinkContext";
import { useInlineProductStore } from "@/components/chat/inline-product-store";
import {
  CuratedPickCard,
  CuratedPickSkeleton,
  GalleryPickCard,
  HeroPickCard,
  SecondaryPickCard,
} from "@/components/curation/PickCards";
import {
  FEATURED_ROW_SLOT_ORDER,
  partitionCuratedPicksForDisplay,
  productDisplayLimitForMode,
  type ShoppingMode,
} from "@/lib/ai-chat/shopping-mode";
import type {
  MessageProductSearchV1,
  ProductSearchInvocation,
} from "@/lib/ai-chat/types";

function filtersBadge(inv: ProductSearchInvocation): string {
  const bits: string[] = [];
  const f = inv.filters;
  if (f?.price_min_cents != null || f?.price_max_cents != null) {
    const min =
      f.price_min_cents != null
        ? `$${(f.price_min_cents / 100).toFixed(0)}+`
        : "";
    const max =
      f.price_max_cents != null
        ? `≤$${(f.price_max_cents / 100).toFixed(0)}`
        : "";
    bits.push([min, max].filter(Boolean).join(" "));
  }
  if (f?.condition?.length) bits.push(f.condition.join(", "));
  if (f?.ships_to_country)
    bits.push(`ships to ${f.ships_to_country.toUpperCase()}`);
  bits.push("in stock");
  return bits.join(" · ");
}

function resolveDisplayLimit(
  invocation: ProductSearchInvocation,
  shoppingMode?: ShoppingMode,
): number {
  if (invocation.displayLimit != null) return invocation.displayLimit;
  if (shoppingMode) return productDisplayLimitForMode(shoppingMode);
  return productDisplayLimitForMode("hybrid");
}

const GALLERY_SCROLL_STEP_PX = 180;
const GALLERY_SCROLL_EDGE_EPSILON_PX = 2;

function readGalleryScrollEdges(el: HTMLDivElement) {
  const maxScroll = el.scrollWidth - el.clientWidth;
  return {
    canScrollLeft: el.scrollLeft > GALLERY_SCROLL_EDGE_EPSILON_PX,
    canScrollRight:
      maxScroll > GALLERY_SCROLL_EDGE_EPSILON_PX &&
      el.scrollLeft < maxScroll - GALLERY_SCROLL_EDGE_EPSILON_PX,
  };
}

function GalleryScrollRow({
  children,
  itemCount,
}: {
  children: ReactNode;
  itemCount: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const syncScrollEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { canScrollLeft: left, canScrollRight: right } =
      readGalleryScrollEdges(el);
    setCanScrollLeft(left);
    setCanScrollRight(right);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    syncScrollEdges();

    el.addEventListener("scroll", syncScrollEdges, { passive: true });
    const observer = new ResizeObserver(syncScrollEdges);
    observer.observe(el);
    const track = el.firstElementChild;
    if (track) observer.observe(track);

    return () => {
      el.removeEventListener("scroll", syncScrollEdges);
      observer.disconnect();
    };
  }, [itemCount, syncScrollEdges]);

  const scrollBy = useCallback((direction: -1 | 1) => {
    scrollRef.current?.scrollBy({
      left: direction * GALLERY_SCROLL_STEP_PX,
      behavior: "smooth",
    });
  }, []);

  const arrowClass =
    "absolute top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-hairline bg-surface-page/95 text-ink-muted shadow-sm backdrop-blur-sm transition-colors hover:bg-surface-tint hover:text-ink";

  return (
    <div className="relative">
      {canScrollLeft ? (
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          className={cn(arrowClass, "left-0")}
          aria-label="Scroll to previous options"
        >
          <ChevronLeft className="size-4" strokeWidth={2.25} aria-hidden />
        </button>
      ) : null}
      {canScrollRight ? (
        <button
          type="button"
          onClick={() => scrollBy(1)}
          className={cn(arrowClass, "right-0")}
          aria-label="Scroll to more options"
        >
          <ChevronRight className="size-4" strokeWidth={2.25} aria-hidden />
        </button>
      ) : null}
      <div
        ref={scrollRef}
        className={cn(
          "overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          canScrollLeft && "pl-9",
          canScrollRight && "pr-9",
        )}
        role="list"
        aria-label="Additional items to consider"
      >
        <div className="flex snap-x snap-mandatory gap-3">{children}</div>
      </div>
    </div>
  );
}

const RawSearchBlock = memo(function RawSearchBlock({
  invocation,
}: {
  invocation: ProductSearchInvocation;
}) {
  const messageId = useChatMessageProductLink();
  const expanded = useInlineProductStore((s) => s.expanded);
  const collapse = useInlineProductStore((s) => s.collapse);
  const expandedProductId =
    expanded?.messageId === messageId ? expanded.productId : null;

  if (invocation.error) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-warning-tint bg-warning-tint/40 px-3 py-2 text-xs text-warning-dark">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          Couldn&apos;t search the catalog for{" "}
          <span className="font-medium">&ldquo;{invocation.query}&rdquo;</span>:{" "}
          {invocation.error}
        </span>
      </div>
    );
  }

  if (!invocation.products.length) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-hairline bg-surface-tint px-3 py-2 text-xs text-ink-soft">
        <PackageSearch className="mt-0.5 size-4 shrink-0" />
        <span>
          No catalog matches for{" "}
          <span className="font-medium">&ldquo;{invocation.query}&rdquo;</span>.
        </span>
      </div>
    );
  }

  const featured = invocation.products.slice(0, 3);
  const rest = invocation.products.slice(3);
  const featuredExpanded =
    expandedProductId != null &&
    featured.some((p) => p.id === expandedProductId);
  const restExpanded =
    expandedProductId != null &&
    rest.some((p) => p.id === expandedProductId);

  return (
    <div className="tp-picks-enter flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 font-medium text-brand ring-1 ring-brand/20">
          <PackageSearch className="size-3" />
          Fashion search
        </span>
        <span className="truncate">&ldquo;{invocation.query}&rdquo;</span>
        <span className="rounded-full bg-surface-tint px-2 py-0.5">
          {invocation.products.length} result
          {invocation.products.length === 1 ? "" : "s"}
        </span>
      </div>

      <div
        className={cn(
          "flex flex-col gap-3 lg:flex-row",
          featuredExpanded && "pb-1",
        )}
        role="list"
        aria-label="Top results"
      >
        {featured[0] ? (
          <div className="min-w-0 flex-1">
            <HeroPickCard product={featured[0]} fashionPickSignals />
          </div>
        ) : null}
        {featured.length > 1 ? (
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
            {featured.slice(1).map((product) => (
              <SecondaryPickCard
                key={product.id}
                product={product}
                fashionPickSignals
              />
            ))}
          </div>
        ) : null}
      </div>
      {featuredExpanded ? <InlineChatProductPanel onClose={collapse} /> : null}

      {rest.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            All results
          </p>
          <div
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            role="list"
            aria-label="All catalog results"
          >
            {rest.map((product) => (
              <SecondaryPickCard
                key={product.id}
                product={product}
                fashionPickSignals
              />
            ))}
          </div>
          {restExpanded ? <InlineChatProductPanel onClose={collapse} /> : null}
        </div>
      ) : null}

      {invocation.truncated ? (
        <p className="text-[11px] text-ink-muted">
          Showing {invocation.products.length} results
          {invocation.truncated
            ? " (catalog has more — Shopify caps fetches at 1,000 per query)."
            : "."}
        </p>
      ) : null}
    </div>
  );
});

const SearchBlock = memo(function SearchBlock({
  invocation,
  shoppingMode,
}: {
  invocation: ProductSearchInvocation;
  shoppingMode?: ShoppingMode;
}) {
  if (invocation.displayMode === "raw") {
    return <RawSearchBlock invocation={invocation} />;
  }

  const fbadge = filtersBadge(invocation);

  if (invocation.error) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-warning-tint bg-warning-tint/40 px-3 py-2 text-xs text-warning-dark">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          Couldn’t search the catalog for{" "}
          <span className="font-medium">“{invocation.query}”</span>:{" "}
          {invocation.error}
        </span>
      </div>
    );
  }

  if (!invocation.products.length) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-hairline bg-surface-tint px-3 py-2 text-xs text-ink-soft">
        <PackageSearch className="mt-0.5 size-4 shrink-0" />
        <span>
          No catalog matches for{" "}
          <span className="font-medium">“{invocation.query}”</span>. Try a
          broader query or relax the filters.
        </span>
      </div>
    );
  }

  const displayLimit = resolveDisplayLimit(invocation, shoppingMode);
  const hasCurated = (invocation.curatedPicks?.length ?? 0) > 0;
  const isEnhancing = hasCurated && invocation.curationPending === true;
  const isAwaitingPicks =
    invocation.curationPending === true &&
    !hasCurated &&
    invocation.products.length > 0;

  const { featured, gallery, omittedCount } = partitionCuratedPicksForDisplay(
    invocation.products,
    invocation.curatedPicks,
    displayLimit,
  );

  const messageId = useChatMessageProductLink();
  const expanded = useInlineProductStore((s) => s.expanded);
  const collapse = useInlineProductStore((s) => s.collapse);
  const expandedProductId =
    expanded?.messageId === messageId ? expanded.productId : null;
  const featuredExpanded =
    expandedProductId != null &&
    featured.some((pick) => pick.id === expandedProductId);
  const galleryExpanded =
    expandedProductId != null &&
    gallery.some((pick) => pick.id === expandedProductId);

  const isCurating = isEnhancing || isAwaitingPicks;

  const pillIcon = isCurating ? (
    <Loader2 className="size-3 animate-spin" />
  ) : hasCurated ? (
    <Sparkles className="size-3" />
  ) : (
    <PackageSearch className="size-3" />
  );
  const pillLabel = isCurating
    ? "Curating picks…"
    : hasCurated
      ? invocation.curationFallback
        ? "Top picks"
        : "Curated by Shoop"
      : "Store results";

  const showFootnote =
    !isEnhancing && (invocation.truncated || omittedCount > 0);

  return (
    <div className="tp-picks-enter flex flex-col gap-3">
      {invocation.directionLabel ? (
        <p className="text-sm font-semibold text-ink">
          {invocation.directionLabel}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 font-medium text-brand ring-1 ring-brand/20">
          {pillIcon}
          {pillLabel}
        </span>
        <span className="truncate">“{invocation.query}”</span>
        {fbadge ? (
          <span className="rounded-full bg-surface-tint px-2 py-0.5">
            {fbadge}
          </span>
        ) : null}
      </div>

      {isAwaitingPicks ? (
        <div
          className="tp-featured-picks-row"
          aria-busy="true"
          aria-live="polite"
          aria-label="Loading curated picks"
        >
          {FEATURED_ROW_SLOT_ORDER.map((slot) => (
            <div
              key={`awaiting-${slot}`}
              className={`tp-featured-picks-slot tp-featured-picks-slot--${slot}`}
            >
              <CuratedPickSkeleton
                variant={slot === "shoop_pick" ? "hero" : "secondary"}
              />
            </div>
          ))}
        </div>
      ) : null}

      {hasCurated ? (
        <div
          className="flex flex-col gap-3"
          aria-busy={isEnhancing}
          aria-live="polite"
        >
          <div
            className={cn(
              "tp-featured-picks-row",
              featuredExpanded && "tp-featured-picks-row--has-expanded",
            )}
            role="list"
            aria-label="Top curated picks"
          >
            {FEATURED_ROW_SLOT_ORDER.map((slot) => {
              const pick = featured.find((p) => p.slot === slot);
              if (!pick) {
                if (isEnhancing) {
                  return (
                    <div
                      key={`slot-${slot}`}
                      className={`tp-featured-picks-slot tp-featured-picks-slot--${slot}`}
                    >
                      <CuratedPickSkeleton
                        variant={slot === "shoop_pick" ? "hero" : "secondary"}
                      />
                    </div>
                  );
                }
                return (
                  <div
                    key={`slot-${slot}`}
                    className={`tp-featured-picks-slot tp-featured-picks-slot--${slot}`}
                    aria-hidden
                  />
                );
              }
              return (
                <CuratedPickCard key={`${pick.slot}-${pick.id}`} pick={pick} />
              );
            })}
          </div>
          {featuredExpanded ? (
            <InlineChatProductPanel onClose={collapse} />
          ) : null}
          {gallery.length ? (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                Additional items to consider
              </p>
              <GalleryScrollRow itemCount={gallery.length}>
                {gallery.map((pick) => (
                  <GalleryPickCard key={pick.id} pick={pick} />
                ))}
              </GalleryScrollRow>
              {galleryExpanded ? (
                <InlineChatProductPanel onClose={collapse} />
              ) : null}
            </div>
          ) : null}
          {messageId ? (
            <SimilarPickSelectionBar sourceMessageId={messageId} />
          ) : null}
        </div>
      ) : null}

      {showFootnote ? (
        <p className="text-[11px] text-ink-muted">
          {[
            invocation.truncated
              ? "The catalog returned more matches than we fetched."
              : null,
            omittedCount > 0
              ? `Showing ${featured.length + gallery.length} of ${invocation.curatedPicks?.length ?? featured.length + gallery.length} curated picks.`
              : null,
            "Ask me to refine if you want more options.",
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}
    </div>
  );
});

export const ProductSearchResults = memo(function ProductSearchResults({
  data,
  shoppingMode,
}: {
  data: MessageProductSearchV1;
  shoppingMode?: ShoppingMode;
}) {
  if (!data.searches.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-4">
      {data.searches.map((inv, i) => (
        <SearchBlock
          key={`${inv.query}-${i}`}
          invocation={inv}
          shoppingMode={shoppingMode}
        />
      ))}
    </div>
  );
});
