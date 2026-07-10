"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import {
  hydratedCandidateToProductCard,
  overflowItemToProductCard,
} from "@/lib/fashion-memory/catalog-search/product-card";
import type { ProductCard } from "@/lib/ai-chat/types";
import { InlineChatProductPanel } from "@/components/chat/InlineChatProductPanel";
import { useChatMessageProductLink } from "@/components/chat/ChatMessageProductLinkContext";
import { useInlineProductStore } from "@/components/chat/inline-product-store";
import {
  FashionLeadPickCard,
  FashionStackPickCard,
  ProductScrollCard,
} from "@/components/curation/PickCards";
import type { MessageFashionCatalogSearchMetaV1 } from "@/lib/fashion-memory/catalog-search/types";

const SCROLL_STEP_PX = 180;
const SCROLL_EDGE_EPS = 2;

function ScrollRow({
  children,
  itemCount,
  ariaLabel,
}: {
  children: ReactNode;
  itemCount: number;
  ariaLabel: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const sync = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > SCROLL_EDGE_EPS);
    setCanScrollRight(
      max > SCROLL_EDGE_EPS && el.scrollLeft < max - SCROLL_EDGE_EPS,
    );
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    const track = el.firstElementChild;
    if (track) observer.observe(track);
    return () => {
      el.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, [itemCount, sync]);

  const arrowClass =
    "absolute top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-hairline bg-page/95 text-ink-secondary shadow-soft backdrop-blur-sm transition-colors hover:bg-white hover:text-ink";

  return (
    <div className="relative -mx-0.5">
      {canScrollLeft ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-[5] w-10 bg-gradient-to-r from-page via-page/80 to-transparent"
          />
          <button
            type="button"
            onClick={() =>
              scrollRef.current?.scrollBy({
                left: -SCROLL_STEP_PX,
                behavior: "smooth",
              })
            }
            className={cn(arrowClass, "-left-1")}
            aria-label="Scroll left"
          >
            <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        </>
      ) : null}
      {canScrollRight ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 z-[5] w-10 bg-gradient-to-l from-page via-page/80 to-transparent"
          />
          <button
            type="button"
            onClick={() =>
              scrollRef.current?.scrollBy({
                left: SCROLL_STEP_PX,
                behavior: "smooth",
              })
            }
            className={cn(arrowClass, "-right-1")}
            aria-label="Scroll right"
          >
            <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        </>
      ) : null}
      <div
        ref={scrollRef}
        className="overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="list"
        aria-label={ariaLabel}
      >
        <div className="flex snap-x snap-mandatory gap-3.5">{children}</div>
      </div>
    </div>
  );
}

/**
 * Layout after funnel ranking:
 *  Row 1 — #1 tall lead | #2 + #3 stacked to same height
 *  Row 2 — remaining verified, small horizontal scroll
 *  Row 3 — unverified overflow, muted scroll
 */
const FashionProductCards = memo(function FashionProductCards({
  verified,
  overflow,
  listLabel,
}: {
  verified: ProductCard[];
  overflow: ProductCard[];
  listLabel: string;
}) {
  const messageId = useChatMessageProductLink();
  const expanded = useInlineProductStore((s) => s.expanded);
  const collapse = useInlineProductStore((s) => s.collapse);
  const expandedProductId =
    expanded?.messageId === messageId ? expanded.productId : null;

  if (!verified.length && !overflow.length) return null;

  const lead = verified[0];
  const stack = verified.slice(1, 3);
  const restVerified = verified.slice(3);

  const topIds = new Set([lead, ...stack].filter(Boolean).map((p) => p!.id));
  const topExpanded =
    expandedProductId != null && topIds.has(expandedProductId);
  const restExpanded =
    expandedProductId != null &&
    restVerified.some((p) => p.id === expandedProductId);
  const overflowExpanded =
    expandedProductId != null &&
    overflow.some((p) => p.id === expandedProductId);

  return (
    <div className="tp-picks-enter flex flex-col gap-5">
      {lead ? (
        <div
          className={cn(
            "fashion-top-finds grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:items-stretch sm:gap-3",
            topExpanded && "pb-1",
          )}
          role="list"
          aria-label={listLabel}
        >
          <div className="min-w-0">
            <FashionLeadPickCard product={lead} fashionPickSignals />
          </div>
          {stack.length ? (
            <div className="flex min-w-0 flex-col gap-2.5">
              {stack.map((product, i) => (
                <div key={product.id} className="min-h-0 flex-1">
                  <FashionStackPickCard
                    product={product}
                    rankLabel={i === 0 ? "Also strong" : "Worth a look"}
                    fashionPickSignals
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {topExpanded ? <InlineChatProductPanel onClose={collapse} /> : null}

      {restVerified.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            More verified ({restVerified.length})
          </p>
          <ScrollRow
            itemCount={restVerified.length}
            ariaLabel={`${listLabel} — more verified`}
          >
            {restVerified.map((product) => (
              <ProductScrollCard
                key={product.id}
                product={product}
                fashionPickSignals
              />
            ))}
          </ScrollRow>
          {restExpanded ? <InlineChatProductPanel onClose={collapse} /> : null}
        </div>
      ) : null}

      {overflow.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            More finds — not verified ({overflow.length})
          </p>
          <ScrollRow
            itemCount={overflow.length}
            ariaLabel={`${listLabel} — unverified`}
          >
            {overflow.map((product) => (
              <ProductScrollCard
                key={product.id}
                product={product}
                fashionPickSignals
                muted
              />
            ))}
          </ScrollRow>
          {overflowExpanded ? (
            <InlineChatProductPanel onClose={collapse} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

function slotSurvivorCards(
  slot: MessageFashionCatalogSearchMetaV1["slots"][number],
): ProductCard[] {
  return (slot.verified_pool ?? []).map(hydratedCandidateToProductCard);
}

export const FashionCatalogResults = memo(function FashionCatalogResults({
  data,
}: {
  data: MessageFashionCatalogSearchMetaV1;
}) {
  if (!data.slots.length) return null;

  return (
    <div className="mt-3 space-y-6">
      {data.slots.map((slot) => {
        const survivors = slotSurvivorCards(slot);
        const droppedCount = slot.dropped?.length ?? 0;
        const verified = Boolean(slot.verified_pool?.length);
        const overflow = (slot.overflow_items ?? []).map(
          overflowItemToProductCard,
        );

        return (
          <div key={slot.slot_id} className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-sm font-semibold text-ink">{slot.garment}</p>
              <p className="text-xs text-ink-muted">
                {survivors.length} {verified ? "verified" : "ranked"} pick
                {survivors.length === 1 ? "" : "s"}
                {droppedCount > 0 ? ` · ${droppedCount} dropped` : ""}
                {slot.thin_slot ? " · thin slot" : ""}
                {slot.brand_status === "translated"
                  ? " · brand translated"
                  : slot.brand_status === "partial"
                    ? " · partial brand pool"
                    : slot.brand_status === "confirmed"
                      ? " · brand confirmed"
                      : ""}
                {" · "}
                {data.timing_ms}ms
              </p>
              {slot.brand_sanity_note ? (
                <p className="w-full text-xs text-ink-soft">
                  {slot.brand_sanity_note}
                </p>
              ) : null}
            </div>

            {survivors.length || overflow.length ? (
              <FashionProductCards
                verified={survivors}
                overflow={overflow}
                listLabel={`${slot.garment} picks`}
              />
            ) : (
              <p className="text-sm text-ink-muted">
                No products survived the funnel for this slot.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
});
