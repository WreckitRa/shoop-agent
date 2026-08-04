"use client";

import { memo, useCallback } from "react";
import type {
  RenderPick,
  RenderPickBadge,
  RenderUnverifiedItem,
  RenderVerifiedItem,
} from "@/lib/fashion-memory/types/render-contract";
import type { MessageFashionCatalogSearchMetaV1 } from "@/lib/fashion-memory/catalog-search/types";
import { cn } from "@/lib/ai-chat/cn";
import { TryOnPickButton } from "@/components/tryon/TryOnPickButton";
import { TryOnLookButton } from "@/components/tryon/TryOnLookButton";
import { FittingRoomAction } from "@/components/tryon/FittingRoomAction";
import { fittingRoomItemFromProductCard, fittingRoomItemFromSearchPick } from "@/components/tryon/fitting-room-item-builders";
import { capsuleLookId } from "@/lib/tryon/outfit-ids";
import { TRYON_DISCLAIMER } from "@/lib/tryon/types";
import { InlineChatProductPanel } from "@/components/chat/InlineChatProductPanel";
import { useChatMessageProductLink } from "@/components/chat/ChatMessageProductLinkContext";
import { useChatStore } from "@/components/chat/chat-store";
import {
  isInlineProductExpanded,
  useInlineProductStore,
} from "@/components/chat/inline-product-store";
import { buildInlineProductState } from "@/lib/shared/productPanelParams";
import { stashChatFocusReturn } from "@/lib/shared/chatFocus";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";

function formatPrice(price: { amount: number; currency: string }) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: price.currency,
  }).format(price.amount / 100);
}

function badgeLabel(badge: RenderPickBadge): string | null {
  switch (badge.kind) {
    case "size_converted":
      return `${badge.merchant_label} — your ${badge.from}`;
    case "size_unknown":
      return "check sizing";
    case "material_suspected":
      return `may contain ${badge.material}`;
    case "photo_color":
      return `photo shows: ${badge.color}`;
    case "near_budget_lifted":
      return "slightly over budget";
    case "brand_unconfirmed":
      return "brand unconfirmed";
    default:
      return null;
  }
}

function useOpenFashionProduct() {
  const messageId = useChatMessageProductLink();
  const conversationId = useChatStore((s) => s.activeConversationId);
  const expand = useInlineProductStore((s) => s.expand);
  const closeTryOn = useTryOnDrawerStore((s) => s.close);

  return useCallback(
    (product: {
      id: string;
      title: string;
      imageUrl?: string;
      displayPrice?: { amount: number; currency: string };
      preferredOptions?: Array<{ name: string; label: string }>;
      featuredVariant?: {
        id: string;
        price?: { amount: number; currency: string };
        checkoutUrl?: string;
        options?: Array<{ name: string; label: string }>;
      };
    }) => {
      if (!messageId || !product.id) return;
      if (isInlineProductExpanded(messageId, product.id)) return;
      closeTryOn();
      if (conversationId) {
        stashChatFocusReturn({
          conversationId,
          messageId,
          productId: product.id,
        });
      }
      expand(
        buildInlineProductState(product.id, {
          messageId,
          title: product.title,
          imageUrl: product.imageUrl,
          preferredOptions: product.preferredOptions,
          featuredVariant: product.featuredVariant,
          displayPrice: product.displayPrice,
        }),
      );
    },
    [closeTryOn, conversationId, expand, messageId],
  );
}

function CuratedPickCard({
  pick,
  searchId,
  compact = false,
  onOpen,
  selected,
}: {
  pick: RenderPick;
  searchId: string;
  compact?: boolean;
  onOpen: () => void;
  selected?: boolean;
}) {
  return (
    <article
      className={cn(
        "flex shrink-0 flex-col overflow-hidden rounded-[14px] border bg-white shadow-[0_12px_28px_-20px_rgba(14,14,17,0.28)] transition-transform duration-150 hover:-translate-y-0.5",
        compact ? "w-[11rem]" : "w-[14rem]",
        selected
          ? "border-ink ring-1 ring-ink/20"
          : "border-hairline",
      )}
    >
      <button
        type="button"
        className="text-left"
        onClick={onOpen}
        aria-expanded={selected}
      >
        <div className="relative aspect-[3/4] bg-surface-tint">
          {pick.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pick.imageUrl}
              alt={pick.title}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-xs text-ink-muted">
              No image
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 p-3">
          <div>
            <p className="line-clamp-2 text-sm font-medium text-ink">
              {pick.title}
            </p>
            {pick.displayPrice ? (
              <p className="mt-0.5 text-xs text-ink-muted">
                {formatPrice(pick.displayPrice)}
              </p>
            ) : null}
          </div>
          {pick.stylist_line ? (
            <p className="text-xs leading-5 text-ink-secondary">
              {pick.stylist_line}
            </p>
          ) : null}
          {pick.badges.length ? (
            <div className="flex flex-wrap gap-1">
              {pick.badges.map((badge, i) => {
                const label = badgeLabel(badge);
                if (!label) return null;
                return (
                  <span
                    key={i}
                    className="rounded-full bg-surface-tint px-2 py-0.5 text-[10px] text-ink-muted"
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      </button>
      <div className="px-3 pb-3">
        <TryOnPickButton pick={pick} searchId={searchId} />
      </div>
    </article>
  );
}

function BenchCard({
  title,
  imageUrl,
  price,
  unverified = false,
  onOpen,
  selected,
  fittingRoomItem,
}: {
  title: string;
  imageUrl?: string;
  price?: { amount: number; currency: string };
  unverified?: boolean;
  onOpen?: () => void;
  selected?: boolean;
  fittingRoomItem?: import("@/lib/tryon/fitting-room-types").FittingRoomItem;
}) {
  const inner = (
    <>
      <div className="relative aspect-[3/4] bg-surface-tint">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={title} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-[10px] text-ink-muted">
            No image
          </div>
        )}
        {unverified ? (
          <span className="absolute bottom-1 left-1 rounded bg-ink/75 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white">
            Unverified
          </span>
        ) : null}
      </div>
      <div className="space-y-0.5 p-2">
        <p className="line-clamp-2 text-[11px] font-medium text-ink">{title}</p>
        {price ? (
          <p className="text-[10px] text-ink-muted">{formatPrice(price)}</p>
        ) : null}
      </div>
    </>
  );

  return (
    <article
      className={cn(
        "flex w-[8.5rem] shrink-0 flex-col overflow-hidden rounded-xl border bg-white",
        unverified
          ? "border-dashed border-hairline opacity-80"
          : "border-hairline",
        selected && "ring-1 ring-ink/15",
      )}
    >
      {onOpen ? (
        <button type="button" className="text-left" onClick={onOpen}>
          {inner}
        </button>
      ) : (
        inner
      )}
      {fittingRoomItem ? (
        <div className="px-2 pb-2">
          <FittingRoomAction item={fittingRoomItem} compact />
        </div>
      ) : null}
    </article>
  );
}

function SlotBenches({
  garment,
  verified,
  unverified,
  openProduct,
  selectedProductId,
  searchId,
}: {
  garment: string;
  verified: RenderVerifiedItem[];
  unverified: RenderUnverifiedItem[];
  openProduct: ReturnType<typeof useOpenFashionProduct>;
  selectedProductId: string | null;
  searchId: string;
}) {
  if (!verified.length && !unverified.length) return null;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          More {garment}
        </h4>
        <p className="text-[11px] text-ink-secondary">
          {verified.length ? `${verified.length} verified` : null}
          {verified.length && unverified.length ? " · " : null}
          {unverified.length
            ? `${unverified.length} unverified (size/stock not checked)`
            : null}
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {verified.map((item) => (
          <BenchCard
            key={item.ref}
            title={item.title}
            imageUrl={item.imageUrl}
            price={item.displayPrice}
            selected={selectedProductId === item.id}
            onOpen={() => openProduct(item)}
            fittingRoomItem={fittingRoomItemFromSearchPick({
              searchId,
              pick: {
                ref: item.ref,
                id: item.id,
                title: item.title,
                imageUrl: item.imageUrl,
                displayPrice: item.displayPrice,
                garment: item.garment,
                badges: [],
                tryon: { available: true, disclaimer: TRYON_DISCLAIMER },
              },
            })}
          />
        ))}
        {verified.length && unverified.length ? (
          <div
            className="mx-1 flex w-px shrink-0 self-stretch bg-hairline"
            aria-hidden
          />
        ) : null}
        {unverified.map((item) => (
          <BenchCard
            key={`${item.slot_id}-${item.product_id}`}
            title={item.title}
            imageUrl={item.image_url}
            price={item.price}
            unverified
            selected={selectedProductId === item.product_id}
            onOpen={() =>
              openProduct({
                id: item.product_id,
                title: item.title,
                imageUrl: item.image_url,
                displayPrice: item.price,
              })
            }
            fittingRoomItem={fittingRoomItemFromProductCard({
              id: item.product_id,
              title: item.title,
              imageUrl: item.image_url,
              displayPrice: item.price,
            })}
          />
        ))}
      </div>
    </section>
  );
}

function groupBySlot<T extends { slot_id: string; garment: string }>(
  items: T[],
): Array<{ slot_id: string; garment: string; items: T[] }> {
  const order: string[] = [];
  const map = new Map<
    string,
    { slot_id: string; garment: string; items: T[] }
  >();
  for (const item of items) {
    let group = map.get(item.slot_id);
    if (!group) {
      group = { slot_id: item.slot_id, garment: item.garment, items: [] };
      map.set(item.slot_id, group);
      order.push(item.slot_id);
    }
    group.items.push(item);
  }
  return order.map((id) => map.get(id)!);
}

export const FashionCurationResults = memo(function FashionCurationResults({
  data,
  searchId,
}: {
  data: MessageFashionCatalogSearchMetaV1;
  searchId: string;
}) {
  const render = data.render ?? null;
  const messageId = useChatMessageProductLink();
  const expanded = useInlineProductStore((s) => s.expanded);
  const collapse = useInlineProductStore((s) => s.collapse);
  const openProduct = useOpenFashionProduct();

  if (!render?.tiers.picks.length) return null;

  const selectedProductId =
    expanded?.messageId === messageId ? expanded.productId : null;

  const openByRef = (ref: string) => {
    const pick =
      render.tiers.picks.find((p) => p.ref === ref) ??
      render.tiers.verified.find((v) => v.ref === ref);
    if (pick) openProduct(pick);
  };

  /** Heroes + verified — looks often reference non-hero pieces (e.g. tie_1). */
  const picksByRef = Object.fromEntries(
    [
      ...render.tiers.verified.map((v) => ({
        ref: v.ref,
        title: v.title,
        price: v.displayPrice,
        imageUrl: v.imageUrl,
        productId: v.id,
        preferredOptions: v.preferredOptions,
        featuredVariant: v.featuredVariant,
        garment: v.garment,
      })),
      ...render.tiers.picks.map((p) => ({
        ref: p.ref,
        title: p.title,
        price: p.displayPrice,
        imageUrl: p.imageUrl,
        productId: p.id,
        preferredOptions: p.preferredOptions,
        featuredVariant: p.featuredVariant,
        garment: p.garment,
      })),
    ].map((row) => [row.ref, row]),
  );

  const resolveLookPick = (ref: string): RenderPick | null => {
    const hero = render.tiers.picks.find((p) => p.ref === ref);
    if (hero) return hero;
    const verified = render.tiers.verified.find((v) => v.ref === ref);
    if (!verified) return null;
    return {
      ...verified,
      role: "support",
      stylist_line: "",
      badges: [],
    };
  };

  const mode = render.meta.mode;
  const isOutfit = mode === "outfit" && (render.looks?.length ?? 0) > 0;
  const isCapsule =
    mode === "capsule" && (render.capsule_outfits?.length ?? 0) > 0;

  const verifiedBySlot = groupBySlot(render.tiers.verified);
  const unverifiedBySlot = groupBySlot(render.tiers.unverified);
  const slotIds = [
    ...new Set([
      ...verifiedBySlot.map((g) => g.slot_id),
      ...unverifiedBySlot.map((g) => g.slot_id),
    ]),
  ];

  const panel =
    selectedProductId != null ? (
      <InlineChatProductPanel onClose={collapse} />
    ) : null;

  return (
    <div className="space-y-6">
      {render.narration.budget_note ? (
        <p className="text-sm text-ink-secondary">{render.narration.budget_note}</p>
      ) : null}

      {isOutfit ? (
        <div className="space-y-5">
          <h3 className="font-display text-xs font-extrabold tracking-[0.06em] text-ink">
            THREE LOOKS
          </h3>
          {render.looks!.map((look) => (
            <section
              key={look.name}
              className="rounded-[14px] border border-hairline bg-white p-4 shadow-[0_12px_28px_-22px_rgba(14,14,17,0.22)]"
            >
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="font-display text-sm font-extrabold tracking-tight text-ink">
                    {look.name}
                  </h3>
                  {look.note ? (
                    <p className="mt-0.5 text-xs text-ink-muted">{look.note}</p>
                  ) : null}
                </div>
                <p className="text-sm font-medium text-ink">
                  ${look.total.toFixed(0)} total
                </p>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {look.item_refs.map((ref) => {
                  const pick = resolveLookPick(ref);
                  if (!pick) return null;
                  return (
                    <CuratedPickCard
                      key={ref}
                      pick={pick}
                      searchId={searchId}
                      compact
                      selected={selectedProductId === pick.id}
                      onOpen={() => openProduct(pick)}
                    />
                  );
                })}
              </div>
              {look.tryon?.available || look.tryon?.cta === "create_avatar" ? (
                <TryOnLookButton
                  look={look}
                  searchId={searchId}
                  picksByRef={picksByRef}
                  onOpenProduct={openByRef}
                />
              ) : null}
            </section>
          ))}
          {panel}
        </div>
      ) : null}

      {isCapsule ? (
        <div className="space-y-5">
          <div>
            <h3 className="font-display text-xs font-extrabold tracking-[0.06em] text-ink">
              CAPSULE ROTATIONS
            </h3>
            {render.meta.set_total != null ? (
              <p className="mt-0.5 text-sm text-ink-secondary">
                Set total ~${render.meta.set_total.toFixed(0)} across rotations
              </p>
            ) : null}
          </div>
          {render.capsule_outfits!.map((outfit, index) => {
            const lookId =
              outfit.look_id ?? capsuleLookId(index, outfit.label);
            const label = outfit.label ?? `Rotation ${index + 1}`;
            const total = outfit.item_refs.reduce((sum, ref) => {
              const meta = picksByRef[ref];
              return sum + (meta?.price?.amount ?? 0) / 100;
            }, 0);
            return (
              <section
                key={lookId}
                className="rounded-[14px] border border-hairline bg-white p-4 shadow-[0_12px_28px_-22px_rgba(14,14,17,0.22)]"
              >
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="font-display text-sm font-extrabold tracking-tight text-ink">
                      {label}
                    </h3>
                  </div>
                  {total > 0 ? (
                    <p className="text-sm font-medium text-ink">
                      ${total.toFixed(0)} total
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {outfit.item_refs.map((ref) => {
                    const pick = resolveLookPick(ref);
                    if (!pick) return null;
                    return (
                      <CuratedPickCard
                        key={ref}
                        pick={pick}
                        searchId={searchId}
                        compact
                        selected={selectedProductId === pick.id}
                        onOpen={() => openProduct(pick)}
                      />
                    );
                  })}
                </div>
                {outfit.tryon?.available ||
                outfit.tryon?.cta === "create_avatar" ? (
                  <TryOnLookButton
                    look={{
                      name: lookId,
                      item_refs: outfit.item_refs,
                      total,
                      tryon: outfit.tryon,
                    }}
                    searchId={searchId}
                    picksByRef={picksByRef}
                    onOpenProduct={openByRef}
                  />
                ) : null}
              </section>
            );
          })}
          {panel}
        </div>
      ) : null}

      {!isOutfit && !isCapsule ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-ink">Top picks</h3>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {render.tiers.picks.map((pick) => (
              <CuratedPickCard
                key={pick.ref}
                pick={pick}
                searchId={searchId}
                selected={selectedProductId === pick.id}
                onOpen={() => openProduct(pick)}
              />
            ))}
          </div>
          {panel}
        </div>
      ) : null}

      {slotIds.length ? (
        <div className="space-y-5 border-t border-hairline pt-5">
          {slotIds.map((slotId) => {
            const verified =
              verifiedBySlot.find((g) => g.slot_id === slotId)?.items ?? [];
            const unverified =
              unverifiedBySlot.find((g) => g.slot_id === slotId)?.items ?? [];
            const garment =
              verified[0]?.garment ?? unverified[0]?.garment ?? slotId;
            return (
              <SlotBenches
                key={slotId}
                garment={garment}
                verified={verified}
                unverified={unverified}
                openProduct={openProduct}
                selectedProductId={selectedProductId}
                searchId={searchId}
              />
            );
          })}
          {selectedProductId &&
          !render.tiers.picks.some((p) => p.id === selectedProductId) ? (
            <InlineChatProductPanel onClose={collapse} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
