"use client";

import { memo, useCallback, type DragEvent } from "react";
import type {
  RenderPick,
  RenderPickBadge,
  RenderVerifiedItem,
} from "@/lib/fashion-memory/types/render-contract";
import type { MessageFashionCatalogSearchMetaV1 } from "@/lib/fashion-memory/catalog-search/types";
import {
  TryOnLookButton,
  lookItemsForFittingRoom,
} from "@/components/tryon/TryOnLookButton";
import { writeFittingDrag } from "@/lib/tryon/fitting-room-drag";
import { ShoopFindCard } from "@/components/chat/ShoopFindCard";
import { fittingRoomItemFromSearchPick } from "@/components/tryon/fitting-room-item-builders";
import { capsuleLookId } from "@/lib/tryon/outfit-ids";
import { TRYON_DISCLAIMER } from "@/lib/tryon/types";
import { InlineChatProductPanel } from "@/components/chat/InlineChatProductPanel";
import { useChatMessageProductLink } from "@/components/chat/ChatMessageProductLinkContext";
import { useChatStore } from "@/components/chat/chat-store";
import { formatPullSheetRecap, formatCountLabel } from "@/lib/fashion-memory/router/pull-sheet";
import { agreedDepth } from "@/lib/fashion-memory/agreed-depth";
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
import {
  accessNeedsAccountForMirror,
  guestFittingCtaLabel,
} from "@/components/tryon/mirror-entry";
import { requestMirror } from "@/components/tryon/request-mirror";
import { useAppSessionStore } from "@/lib/client/app-session";

function dragLookOntoStage(
  event: DragEvent,
  look: { name: string; item_refs: string[] },
  searchId: string,
  picksByRef: Parameters<typeof lookItemsForFittingRoom>[0]["picksByRef"],
) {
  const items = lookItemsForFittingRoom({ look, searchId, picksByRef });
  if (!items.length) {
    event.preventDefault();
    return;
  }
  writeFittingDrag(event.dataTransfer, {
    kind: "look",
    title: look.name,
    searchId,
    lookId: look.name,
    items,
  });
}

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
}: {
  pick: RenderPick;
  searchId: string;
  compact?: boolean;
  onOpen: () => void;
  selected?: boolean;
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
      tryonAvailable={pick.tryon == null || pick.tryon.available === true}
      tryonCta={pick.tryon?.cta}
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
  const needsAccount = accessNeedsAccountForMirror(
    useAppSessionStore((s) => s.mode),
  );

  if (!picks.length) return null;

  const items = picks.map((pick) =>
    fittingRoomItemFromSearchPick({ pick, searchId }),
  );
  // Missing tryon (pre-attach) is optimistic — only hide when explicitly unavailable.
  const anyTryon = picks.some(
    (p) => p.tryon == null || p.tryon.available === true,
  );
  const wantsAvatar = picks.some((p) => p.tryon?.cta === "create_avatar");
  const cta = resolveTryonCta({
    available: anyTryon,
    cta: wantsAvatar ? "create_avatar" : undefined,
    avatarStatus,
  });

  if (cta === "hidden") return null;

  if (needsAccount) {
    return (
      <button
        type="button"
        className="shoop-quiz-apply"
        onClick={() => requestMirror()}
      >
        {guestFittingCtaLabel("button")}
        <span aria-hidden>→</span>
      </button>
    );
  }

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
          openAndDressItems({ items, title });
          return;
        }
        addManyToFittingRoom(items);
        openFittingRoom();
      }}
    >
      See it on you
      <span aria-hidden>→</span>
    </button>
  );
}

function SlotBenches({
  garment,
  verified,
  openProduct,
  selectedProductId,
  searchId,
}: {
  garment: string;
  verified: RenderVerifiedItem[];
  openProduct: ReturnType<typeof useOpenFashionProduct>;
  selectedProductId: string | null;
  searchId: string;
}) {
  if (!verified.length) return null;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          More {garment}
        </h4>
        <p className="text-[11px] text-ink-secondary">
          {verified.length} sized &amp; in stock
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
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setInput = useChatStore((s) => s.setInput);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const recap = useChatStore((s) => {
    for (let i = s.messages.length - 1; i >= 0; i--) {
      const brief = s.messages[i]?.metadata?.fashionRouter?.brief;
      if (!brief) continue;
      const line = formatPullSheetRecap(brief);
      if (line) return line;
    }
    return null;
  });
  const looksLabel = useChatStore((s) => {
    for (let i = s.messages.length - 1; i >= 0; i--) {
      const brief = s.messages[i]?.metadata?.fashionRouter?.brief;
      if (!brief) continue;
      if (brief.request_type !== "outfit" && brief.request_type !== "capsule") {
        continue;
      }
      const n = agreedDepth(brief).looks;
      return formatCountLabel(n, "look", "looks");
    }
    return null;
  });

  if (!render?.tiers.picks.length) return null;
  if (data.provisional) return null;

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
  const slotIds = verifiedBySlot.map((g) => g.slot_id);

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
          <h3 className="shoop-lookshead">{looksLabel ?? formatCountLabel(render.looks!.length, "look", "looks")}</h3>
          {render.looks!.map((look) => (
            <section
              key={look.name}
              className="shoop-look"
              draggable
              onDragStart={(e) =>
                dragLookOntoStage(e, look, searchId, picksByRef)
              }
            >
              <div className="shoop-look__top">
                <div>
                  <h4>{look.name}</h4>
                  {look.note ? <p className="sub">{look.note}</p> : null}
                </div>
                <b className="shoop-look__price">${look.total.toFixed(0)}</b>
              </div>
              <div className="shoop-look__body">
                <div className="shoop-look__items">
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
                {look.item_refs.length ? (
                  <div className="shoop-look__cta">
                    <TryOnLookButton
                      look={look}
                      searchId={searchId}
                      picksByRef={picksByRef}
                      onOpenProduct={openByRef}
                    />
                  </div>
                ) : null}
              </div>
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
                className="shoop-look"
                draggable
                onDragStart={(e) =>
                  dragLookOntoStage(
                    e,
                    { name: lookId, item_refs: outfit.item_refs },
                    searchId,
                    picksByRef,
                  )
                }
              >
                <div className="shoop-look__top">
                  <div>
                    <h4>{label}</h4>
                  </div>
                  {total > 0 ? (
                    <b className="shoop-look__price">${total.toFixed(0)}</b>
                  ) : null}
                </div>
                <div className="shoop-look__body">
                  <div className="shoop-look__items">
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
                  {outfit.item_refs.length ? (
                    <div className="shoop-look__cta">
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
                    </div>
                  ) : null}
                </div>
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
            const garment = verified[0]?.garment ?? slotId;
            return (
              <SlotBenches
                key={slotId}
                garment={garment}
                verified={verified}
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
      {recap ? (
        <p className="mt-4 text-sm text-ink-soft">{recap}</p>
      ) : null}
      {render.narration.next_step_offer?.chips.length ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-ink-soft">
            {render.narration.next_step_offer.text}
          </p>
          <div className="flex flex-wrap gap-2">
            {render.narration.next_step_offer.chips.map((chip) => (
              <button
                key={chip}
                type="button"
                disabled={isStreaming}
                onClick={() => {
                  setInput(chip);
                  void sendMessage();
                }}
                className="rounded-full border border-hairline px-3 py-1.5 text-sm text-ink-soft hover:border-ink disabled:opacity-50"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
});
