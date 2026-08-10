"use client";

import { memo } from "react";
import {
  hydratedCandidateToProductCard,
  overflowItemToProductCard,
} from "@/lib/fashion-memory/catalog-search/product-card";
import type { ProductCard } from "@/lib/ai-chat/types";
import { InlineChatProductPanel } from "@/components/chat/InlineChatProductPanel";
import { useChatMessageProductLink } from "@/components/chat/ChatMessageProductLinkContext";
import { useInlineProductStore } from "@/components/chat/inline-product-store";
import { ProductScrollCard } from "@/components/curation/PickCards";
import type { MessageFashionCatalogSearchMetaV1 } from "@/lib/fashion-memory/catalog-search/types";

/**
 * Layout after funnel ranking — same rack cards as curated finds.
 *  Row 1 — verified finds in horizontal rack
 *  Row 2 — unverified overflow, muted
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

  const verifiedExpanded =
    expandedProductId != null &&
    verified.some((p) => p.id === expandedProductId);
  const overflowExpanded =
    expandedProductId != null &&
    overflow.some((p) => p.id === expandedProductId);

  return (
    <div className="tp-picks-enter flex flex-col gap-5">
      {verified.length ? (
        <div role="list" aria-label={listLabel}>
          <div className="shoop-vrack !mt-0">
            {verified.map((product) => (
              <ProductScrollCard key={product.id} product={product} />
            ))}
          </div>
          {verifiedExpanded ? (
            <InlineChatProductPanel onClose={collapse} />
          ) : null}
        </div>
      ) : null}

      {overflow.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            More finds — not verified ({overflow.length})
          </p>
          <div className="shoop-vrack !mt-0" role="list" aria-label={`${listLabel} — unverified`}>
            {overflow.map((product) => (
              <ProductScrollCard key={product.id} product={product} muted />
            ))}
          </div>
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
  return (slot.verified_pool ?? []).map((p) => hydratedCandidateToProductCard(p));
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

        if (!survivors.length && !overflow.length) return null;

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
