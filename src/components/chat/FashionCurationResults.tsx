"use client";

import { memo, useCallback } from "react";
import type {
  RenderPick,
  RenderPickBadge,
  RenderUnverifiedItem,
  RenderVerifiedItem,
} from "@/lib/fashion-memory/types/render-contract";
import type { MessageFashionCatalogSearchMetaV1 } from "@/lib/fashion-memory/catalog-search/types";
import { TryOnLookButton } from "@/components/tryon/TryOnLookButton";
import { ShoopFindCard } from "@/components/chat/ShoopFindCard";
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
import {
  resolveTryonCta,
  useSelfAvatarStore,
} from "@/components/tryon/self-avatar-store";

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

function whyMeta(pick: RenderPick): string {
  if (pick.stylist_line?.trim()) return pick.stylist_line.trim();
  const bits = pick.badges
    .map((badge) => badgeLabel(badge))
    .filter((label): label is string => Boolean(label));
  return bits.join(" · ");
}

function CuratedPickCard({
  pick,
  searchId,
  compact = false,
  onOpen,
  selected,
  hideTryOnOverlay = false,
}: {
  pick: RenderPick;
  searchId: string;
  compact?: boolean;
  onOpen: () => void;
  selected?: boolean;
  hideTryOnOverlay?: boolean;
}) {
  const meta = whyMeta(pick);
  const item = fittingRoomItemFromSearchPick({ pick, searchId });
  const priceLabel = pick.displayPrice ? formatPrice(pick.displayPrice) : null;

  return (
    <ShoopFindCard
      title={pick.title}
      imageUrl={pick.imageUrl}
      priceLabel={priceLabel}
      meta={meta || null}
      selected={selected}
      compact={compact}
      onOpen={onOpen}
      fittingItem={item}
      tryonAvailable={pick.tryon?.available}
      tryonCta={pick.tryon?.cta}
      hideTryOnOverlay={hideTryOnOverlay}
    />
  );
}

function ChangingRoomCta({
  picks,
  searchId,
  title,
}: {
  picks: RenderPick[];
  searchId: string;
  title: string;
}) {
  const openAndDressItems = useTryOnDrawerStore((s) => s.openAndDressItems);
  const addManyToFittingRoom = useTryOnDrawerStore((s) => s.addManyToFittingRoom);
  const openFittingRoom = useTryOnDrawerStore((s) => s.openFittingRoom);
  const openCreateFlow = useSelfAvatarStore((s) => s.openCreateFlow);
  const avatarStatus = useSelfAvatarStore((s) => s.status);

  if (!picks.length) return null;

  const items = picks.map((pick) =>
    fittingRoomItemFromSearchPick({ pick, searchId }),
  );
  const anyTryon = picks.some((p) => p.tryon?.available !== false);
  const wantsAvatar = picks.some((p) => p.tryon?.cta === "create_avatar");
  const cta = resolveTryonCta({
    available: anyTryon,
    cta: wantsAvatar ? "create_avatar" : undefined,
    avatarStatus,
  });

  if (cta === "hidden") return null;

  if (cta === "create_avatar") {
    return (
      <button
        type="button"
        className="shoop-quiz-apply"
        onClick={() => openCreateFlow()}
      >
        Create your avatar
        <span aria-hidden>→</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      data-tryon-trigger
      className="shoop-quiz-apply"
      onClick={() => {
        if (anyTryon) {
          // Rack picks aren't a named curation look — dress via fitting-room.
          openAndDressItems({ items, title });
          return;
        }
        addManyToFittingRoom(items);
        openFittingRoom();
      }}
    >
      Take the look to the changing room
      <span aria-hidden>→</span>
    </button>
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
      <div className="shoop-vrack !mt-0">
        {verified.map((item) => (
          <ShoopFindCard
            key={item.ref}
            title={item.title}
            imageUrl={item.imageUrl}
            priceLabel={
              item.displayPrice ? formatPrice(item.displayPrice) : null
            }
            selected={selectedProductId === item.id}
            compact
            onOpen={() => openProduct(item)}
            fittingItem={fittingRoomItemFromSearchPick({
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
            tryonAvailable
          />
        ))}
        {unverified.map((item) => (
          <ShoopFindCard
            key={`${item.slot_id}-${item.product_id}`}
            title={item.title}
            imageUrl={item.image_url}
            priceLabel={item.price ? formatPrice(item.price) : null}
            meta="Unverified"
            selected={selectedProductId === item.product_id}
            compact
            muted
            onOpen={() =>
              openProduct({
                id: item.product_id,
                title: item.title,
                imageUrl: item.image_url,
                displayPrice: item.price,
              })
            }
            fittingItem={fittingRoomItemFromProductCard({
              id: item.product_id,
              title: item.title,
              imageUrl: item.image_url,
              displayPrice: item.price,
            })}
            tryonAvailable
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
  // Prefer composed looks whenever the curator delivered them — even if the
  // brief was mis-tagged multi_item (outfit language should have coerced).
  const hasComposedLooks =
    (render.looks?.length ?? 0) > 0 &&
    (render.looks?.some((l) => (l.item_refs?.length ?? 0) > 0) ?? false);
  const isOutfit =
    hasComposedLooks && (mode === "outfit" || mode === "multi_item");
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
              <div className="shoop-vrack !mt-0">
                {look.item_refs.map((ref) => {
                  const pick = resolveLookPick(ref);
                  if (!pick) return null;
                  return (
                    <CuratedPickCard
                      key={ref}
                      pick={pick}
                      searchId={searchId}
                      compact
                      hideTryOnOverlay
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
                <div className="shoop-vrack !mt-0">
                  {outfit.item_refs.map((ref) => {
                    const pick = resolveLookPick(ref);
                    if (!pick) return null;
                    return (
                      <CuratedPickCard
                        key={ref}
                        pick={pick}
                        searchId={searchId}
                        compact
                        hideTryOnOverlay
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
        <div>
          <div className="shoop-vrack">
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
          {render.narration.thin_note ? (
            <p className="shoop-pickline">{render.narration.thin_note}</p>
          ) : render.narration.brand_note ? (
            <p className="shoop-pickline">{render.narration.brand_note}</p>
          ) : null}
          <ChangingRoomCta
            picks={render.tiers.picks}
            searchId={searchId}
            title="Your rack"
          />
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
