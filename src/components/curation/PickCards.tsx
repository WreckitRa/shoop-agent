"use client";

import { PickReplyButton } from "@/components/chat/PickReplyButton";
import { useChatStore } from "@/components/chat/chat-store";
import { useChatFocusHighlight } from "@/components/chat/ChatFocusHighlightContext";
import { useChatMessageProductLink } from "@/components/chat/ChatMessageProductLinkContext";
import { InlineChatProductPanel } from "@/components/chat/InlineChatProductPanel";
import { useInlineProductStore } from "@/components/chat/inline-product-store";
import { cn } from "@/lib/ai-chat/cn";
import { colors, fontWeight, radii, shadows } from "@/lib/design/tokens";
import { useCatalogLocalization } from "@/hooks/useCatalogLocalization";
import { displayCurrencyFromLocalization } from "@/lib/shopify/catalog-localization";
import { chatProductDomId, stashChatFocusReturn } from "@/lib/shared/chatFocus";
import { buildInlineProductState } from "@/lib/shared/productPanelParams";
import type { CuratedPick, ProductCard } from "@/lib/ai-chat/types";
import { CATALOG_IMAGE_PX } from "@/lib/shopify/catalog-display-image";
import { recordFashionPickSelection } from "@/lib/fashion-memory/client/pick-signals";
import { ShoopFindCard } from "@/components/chat/ShoopFindCard";
import { fittingRoomItemFromProductCard } from "@/components/tryon/fitting-room-item-builders";

/** Expand the full PDP inline in chat below the picks row (card stays visible). */
function useProductCardAction(product: ProductCard) {
  const conversationId = useChatStore((s) => s.activeConversationId);
  const messageId = useChatMessageProductLink();
  const expand = useInlineProductStore((s) => s.expand);
  const collapse = useInlineProductStore((s) => s.collapse);
  const expanded = useInlineProductStore((s) => s.expanded);
  const highlight = useChatFocusHighlight();
  const isFocused =
    highlight?.productId != null && highlight.productId === product.id;
  const isExpanded =
    expanded?.messageId === messageId && expanded?.productId === product.id;

  const onOpen = () => {
    if (!messageId || isExpanded) return;
    recordFashionPickSelection(product, conversationId);
    if (conversationId && messageId) {
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
        priceRange: product.priceRange,
        featuredVariant: product.featuredVariant,
        displayPrice: product.displayPrice,
      }),
    );
  };

  return {
    id: chatProductDomId(product.id),
    className: cn(
      isFocused && "chat-product-focus-ring",
      isExpanded && "chat-product-selected",
    ),
    onOpen,
    isExpanded,
    collapse,
  };
}

function formatSinglePrice(amount: number, currency: string): string | null {
  const value = amount / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return null;
  }
}

function formatPrice(
  product: ProductCard,
  buyerCurrency?: string | null,
): string | null {
  const displayCurrency = buyerCurrency?.trim().toUpperCase() || null;
  const single = product.displayPrice ?? product.featuredVariant?.price;
  if (single) {
    return formatSinglePrice(
      single.amount,
      displayCurrency ?? single.currency,
    );
  }
  const r = product.priceRange;
  if (!r) return null;
  const minCurrency = displayCurrency ?? r.min.currency;
  const maxCurrency = displayCurrency ?? r.max.currency;
  const value = r.min.amount / 100;
  try {
    const minLabel = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: minCurrency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
    if (
      r.min.amount === r.max.amount &&
      (displayCurrency || r.min.currency === r.max.currency)
    ) {
      return minLabel;
    }
    const maxVal = r.max.amount / 100;
    const maxLabel = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: maxCurrency,
      maximumFractionDigits: maxVal % 1 === 0 ? 0 : 2,
    }).format(maxVal);
    return `${minLabel} – ${maxLabel}`;
  } catch {
    return null;
  }
}

function useBuyerDisplayCurrency(): string | null {
  const { localization } = useCatalogLocalization();
  return displayCurrencyFromLocalization(localization);
}

/** Placeholder while the Opus curator pass is in flight. */
export function CuratedPickSkeleton({
  variant,
}: {
  variant: "hero" | "secondary";
}) {
  const isHero = variant === "hero";
  return (
    <div
      className="animate-pulse motion-reduce:animate-none"
      aria-hidden
      style={{
        flex: "0 1 auto",
        width: "100%",
        maxWidth: isHero ? 196 : 168,
        minWidth: 0,
        background: colors.surface,
        border: `1px solid ${colors.hairline}`,
        borderRadius: isHero ? radii["2xl"] : radii.xl,
        boxShadow: isHero ? shadows.soft : undefined,
        padding: isHero ? 14 : 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          height: 10,
          width: isHero ? 88 : 72,
          borderRadius: 6,
          background: colors.surfaceSubtle,
        }}
      />
      <div
        style={{
          width: "100%",
          aspectRatio: "1",
          borderRadius: radii.xl,
          background: colors.surfaceSubtle,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            height: isHero ? 14 : 12,
            width: "88%",
            borderRadius: 6,
            background: colors.surfaceSubtle,
          }}
        />
        <div
          style={{
            height: isHero ? 16 : 14,
            width: "40%",
            borderRadius: 6,
            background: colors.surfaceSubtle,
          }}
        />
        <div
          style={{
            height: 9,
            width: "100%",
            borderRadius: 6,
            background: colors.surfaceSubtle,
          }}
        />
      </div>
    </div>
  );
}

export function HeroPickCard({ product }: { product: ProductCard }) {
  const link = useProductCardAction(product);
  const buyerCurrency = useBuyerDisplayCurrency();
  const price = formatPrice(product, buyerCurrency);

  return (
    <>
      <ShoopFindCard
        domId={link.id}
        title={product.title}
        imageUrl={product.imageUrl}
        priceLabel={price}
        meta="Shoop's pick"
        selected={link.isExpanded}
        onOpen={link.onOpen}
        fittingItem={fittingRoomItemFromProductCard(product)}
        className={cn(link.className, "mb-4")}
        testId="hero-pick"
        imagePriority
        imagePx={CATALOG_IMAGE_PX.lead}
      />
      {link.isExpanded ? (
        <InlineChatProductPanel onClose={link.collapse} />
      ) : null}
    </>
  );
}

/**
 * Featured card for the horizontal top-picks row (Best Value / Shoop's Pick / Most Popular).
 */
export function CuratedPickCard({ pick }: { pick: CuratedPick }) {
  const link = useProductCardAction(pick);
  const buyerCurrency = useBuyerDisplayCurrency();
  const price = formatPrice(pick, buyerCurrency);
  const isHero = pick.slot === "shoop_pick";
  const ratingBits =
    pick.rating && pick.rating.count > 0
      ? `★ ${
          pick.rating.scaleMax && pick.rating.scaleMax !== 5
            ? ((pick.rating.value / pick.rating.scaleMax) * 5).toFixed(1)
            : pick.rating.value.toFixed(1)
        } (${pick.rating.count.toLocaleString()})`
      : null;
  const meta = [pick.reason?.trim(), pick.caveat ? `⚠ ${pick.caveat}` : null, ratingBits]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="relative h-full min-h-0 w-full">
      <PickReplyButton pick={pick} className="absolute right-2 top-2 z-20" />
      <ShoopFindCard
        domId={link.id}
        title={pick.title}
        imageUrl={pick.imageUrl}
        priceLabel={price}
        meta={meta || (isHero ? "Shoop's pick" : pick.slot.replace(/_/g, " "))}
        selected={link.isExpanded}
        fluid
        onOpen={link.onOpen}
        fittingItem={fittingRoomItemFromProductCard(pick)}
        className={cn(
          "h-full",
          link.className,
          isHero ? "tp-pick-card" : "tp-alt-card",
        )}
        testId={`curated-pick-${pick.slot}`}
        imagePriority={isHero}
        imagePx={CATALOG_IMAGE_PX.lead}
      />
    </div>
  );
}

/** Rack card for the horizontal gallery row. */
export function GalleryPickCard({ pick }: { pick: CuratedPick }) {
  const link = useProductCardAction(pick);
  const buyerCurrency = useBuyerDisplayCurrency();
  const price = formatPrice(pick, buyerCurrency);
  const meta = pick.reason?.trim() || null;

  return (
    <div className="relative shrink-0 snap-start">
      <PickReplyButton pick={pick} className="absolute right-2 top-2 z-20" />
      <ShoopFindCard
        domId={link.id}
        title={pick.title}
        imageUrl={pick.imageUrl}
        priceLabel={price}
        meta={meta}
        selected={link.isExpanded}
        compact
        onOpen={link.onOpen}
        fittingItem={fittingRoomItemFromProductCard(pick)}
        className={link.className}
        testId={`gallery-pick-${pick.id}`}
        imagePx={CATALOG_IMAGE_PX.scroll}
      />
    </div>
  );
}

export function GalleryPickSkeleton() {
  return (
    <div
      className="shrink-0 animate-pulse snap-start motion-reduce:animate-none"
      aria-hidden
      style={{
        width: 164,
        background: colors.surface,
        border: `1px solid ${colors.hairline}`,
        borderRadius: radii.xl,
        boxShadow: shadows.soft,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: "1",
          background: colors.surfaceSubtle,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px 12px" }}>
        <div
          style={{
            height: 12,
            width: "92%",
            borderRadius: 6,
            background: colors.surfaceSubtle,
          }}
        />
        <div
          style={{
            height: 12,
            width: "45%",
            borderRadius: 6,
            background: colors.surfaceSubtle,
          }}
        />
      </div>
    </div>
  );
}

/**
 * Lead find card — same rack style as curation results.
 */
export function FashionLeadPickCard({ product }: { product: ProductCard }) {
  const link = useProductCardAction(product);
  const buyerCurrency = useBuyerDisplayCurrency();
  const price = formatPrice(product, buyerCurrency);
  const rating =
    product.rating && product.rating.count > 0
      ? `★ ${product.rating.value.toFixed(1)} (${product.rating.count.toLocaleString()})`
      : null;

  return (
    <ShoopFindCard
      domId={link.id}
      title={product.title}
      imageUrl={product.imageUrl}
      priceLabel={price}
      meta={["Top find", rating].filter(Boolean).join(" · ")}
      selected={link.isExpanded}
      fluid
      onOpen={link.onOpen}
      fittingItem={fittingRoomItemFromProductCard(product)}
      className={cn(link.className, "tp-pick-card h-full")}
      testId="fashion-lead-pick"
      imagePriority
      imagePx={CATALOG_IMAGE_PX.lead}
    />
  );
}

/**
 * Runner-up find card — same rack style as curation results.
 */
export function FashionStackPickCard({
  product,
  rankLabel,
}: {
  product: ProductCard;
  rankLabel: string;
}) {
  const link = useProductCardAction(product);
  const buyerCurrency = useBuyerDisplayCurrency();
  const price = formatPrice(product, buyerCurrency);

  return (
    <ShoopFindCard
      domId={link.id}
      title={product.title}
      imageUrl={product.imageUrl}
      priceLabel={price}
      meta={rankLabel}
      selected={link.isExpanded}
      fluid
      compact
      onOpen={link.onOpen}
      fittingItem={fittingRoomItemFromProductCard(product)}
      className={cn(link.className, "tp-alt-card h-full")}
      testId="fashion-stack-pick"
      imagePx={CATALOG_IMAGE_PX.stack}
    />
  );
}

/** Compact rack card for horizontal scroll rows (verified rest / overflow). */
export function ProductScrollCard({
  product,
  muted,
}: {
  product: ProductCard;
  /** Soften unverified / overflow finds. */
  muted?: boolean;
}) {
  const link = useProductCardAction(product);
  const buyerCurrency = useBuyerDisplayCurrency();
  const price = formatPrice(product, buyerCurrency);

  return (
    <div className="shrink-0 snap-start">
      <ShoopFindCard
        domId={link.id}
        title={product.title}
        imageUrl={product.imageUrl}
        priceLabel={price}
        selected={link.isExpanded}
        compact
        muted={muted}
        onOpen={link.onOpen}
        fittingItem={fittingRoomItemFromProductCard(product)}
        className={link.className}
        testId="product-scroll-card"
        imagePx={CATALOG_IMAGE_PX.scroll}
      />
    </div>
  );
}

export function SecondaryPickCard({ product }: { product: ProductCard }) {
  const link = useProductCardAction(product);
  const buyerCurrency = useBuyerDisplayCurrency();
  const price = formatPrice(product, buyerCurrency);

  return (
    <>
      <ShoopFindCard
        domId={link.id}
        title={product.title}
        imageUrl={product.imageUrl}
        priceLabel={price}
        selected={link.isExpanded}
        onOpen={link.onOpen}
        fittingItem={fittingRoomItemFromProductCard(product)}
        className={cn(link.className, "mb-3")}
        testId="secondary-pick"
        imagePx={CATALOG_IMAGE_PX.scroll}
      />
      {link.isExpanded ? (
        <InlineChatProductPanel onClose={link.collapse} />
      ) : null}
    </>
  );
}

