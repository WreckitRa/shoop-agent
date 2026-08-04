"use client";

import { PickFindSimilarButton } from "@/components/chat/PickFindSimilarButton";
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
import type { CatalogProductRating } from "@/lib/shopify/catalog";
import {
  CATALOG_IMAGE_PX,
  catalogDisplayImageUrl,
} from "@/lib/shopify/catalog-display-image";
import { recordFashionPickSelection } from "@/lib/fashion-memory/client/pick-signals";
import { FittingRoomAction } from "@/components/tryon/FittingRoomAction";
import { fittingRoomItemFromProductCard } from "@/components/tryon/fitting-room-item-builders";

/** Expand the full PDP inline in chat below the picks row (card stays visible). */
function useProductCardAction(
  product: ProductCard,
  opts?: { fashionPickSignals?: boolean },
) {
  const conversationId = useChatStore((s) => s.activeConversationId);
  const fashionMode = useChatStore((s) => s.fashionMode);
  const recordFashionPick =
    opts?.fashionPickSignals === true || fashionMode;
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
    if (recordFashionPick) {
      recordFashionPickSelection(product, conversationId);
    }
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

export function HeroPickCard({
  product,
  fashionPickSignals,
}: {
  product: ProductCard;
  fashionPickSignals?: boolean;
}) {
  const link = useProductCardAction(product, { fashionPickSignals });
  const buyerCurrency = useBuyerDisplayCurrency();
  const price = formatPrice(product, buyerCurrency);

  return (
    <>
    <div
      className={cn(
        "relative min-w-0 w-full overflow-hidden tp-pick-card",
        link.className,
      )}
      style={{
        background: colors.surface,
        border: `1px solid ${colors.hairline}`,
        boxShadow: shadows.card,
        borderRadius: radii.xl,
        marginBottom: 16,
      }}
    >
    <button
      type="button"
      id={link.id}
      onClick={link.onOpen}
      aria-expanded={link.isExpanded}
      className="w-full"
      data-testid="hero-pick"
      style={{
        width: "100%",
        background: "transparent",
        border: "none",
        padding: 18,
        paddingBottom: 12,
        cursor: "pointer",
        display: "flex",
        gap: 20,
        alignItems: "center",
        transition: "background-color 200ms",
        textAlign: "left",
      }}
    >
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={catalogDisplayImageUrl(product.imageUrl, CATALOG_IMAGE_PX.scroll)}
          alt={product.title}
          loading="lazy"
          decoding="async"
          style={{
            width: 132,
            height: 132,
            borderRadius: radii.lg,
            objectFit: "cover",
            flexShrink: 0,
            background: colors.surfaceSubtle,
          }}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          style={{
            width: 132,
            height: 132,
            borderRadius: radii.lg,
            flexShrink: 0,
            background: colors.surfaceSubtle,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: colors.inkMuted,
            fontSize: 36,
            fontWeight: fontWeight.semibold,
          }}
          aria-hidden
        >
          {product.title.charAt(0)}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: fontWeight.semibold,
            letterSpacing: "0.1em",
            color: colors.brand,
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          Shoop&apos;s pick
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: fontWeight.medium,
            color: colors.ink,
            marginBottom: 4,
            lineHeight: 1.25,
          }}
        >
          {product.title}
        </div>
        {price ? (
          <span
            style={{
              fontSize: 20,
              fontWeight: fontWeight.bold,
              color: colors.ink,
            }}
          >
            {price}
          </span>
        ) : null}
      </div>
    </button>
    <div className="px-3 pb-2">
      <FittingRoomAction item={fittingRoomItemFromProductCard(product)} compact />
    </div>
    <PickFindSimilarButton pick={product} />
    </div>
    {link.isExpanded ? (
      <InlineChatProductPanel onClose={link.collapse} />
    ) : null}
    </>
  );
}

/** Compact star rating + review count, e.g. "★ 4.6 (211)". */
function RatingTag({
  rating,
  size = "sm",
}: {
  rating: CatalogProductRating | undefined;
  size?: "sm" | "xs";
}) {
  if (!rating || rating.count <= 0) return null;
  const normalized =
    rating.scaleMax && rating.scaleMax !== 5
      ? (rating.value / rating.scaleMax) * 5
      : rating.value;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: size === "sm" ? 11 : 10,
        fontWeight: 600,
        color: colors.inkSoft,
      }}
    >
      <span aria-hidden style={{ color: colors.warning }}>
        ★
      </span>
      {normalized.toFixed(1)}
      <span style={{ color: colors.inkMuted }}>
        ({rating.count.toLocaleString()})
      </span>
    </span>
  );
}

/**
 * Square featured card for the horizontal top-picks row (Best Value / Shoop's
 * Pick / Most Popular). Shoop's pick is slightly larger when centered in the row.
 */
export function CuratedPickCard({ pick }: { pick: CuratedPick }) {
  const link = useProductCardAction(pick);
  const buyerCurrency = useBuyerDisplayCurrency();
  const price = formatPrice(pick, buyerCurrency);
  const isHero = pick.slot === "shoop_pick";

  return (
    <div
      className={cn(
        "tp-curated-pick-card relative flex h-full min-h-0 w-full flex-col overflow-hidden",
        `tp-curated-pick-card--${pick.slot}`,
        isHero && "tp-curated-pick-card--hero",
        isHero ? "tp-pick-card" : "tp-alt-card",
        link.className,
      )}
      style={{
        background: colors.surface,
        border: `1px solid ${colors.hairline}`,
        borderRadius: radii.xl,
        boxShadow: isHero ? shadows.card : shadows.soft,
        textAlign: "left",
      }}
    >
      <PickReplyButton pick={pick} className="absolute right-2.5 top-2.5 z-10" />
      <button
      type="button"
      id={link.id}
      onClick={link.onOpen}
      aria-expanded={link.isExpanded}
      className="min-h-0 w-full flex-1"
      data-testid={`curated-pick-${pick.slot}`}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        transition: "background-color 200ms",
        textAlign: "left",
      }}
    >
      <div style={{ position: "relative", width: "100%" }}>
        {pick.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={catalogDisplayImageUrl(pick.imageUrl, CATALOG_IMAGE_PX.lead)}
            alt={pick.title}
            decoding="async"
            fetchPriority="high"
            style={{
              width: "100%",
              aspectRatio: "1",
              objectFit: "cover",
              display: "block",
              background: colors.surfaceSubtle,
            }}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            style={{
              width: "100%",
              aspectRatio: "1",
              background: colors.surfaceSubtle,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: colors.inkMuted,
              fontSize: isHero ? 36 : 28,
              fontWeight: fontWeight.semibold,
            }}
            aria-hidden
          >
            {pick.title.charAt(0)}
          </div>
        )}
        {isHero ? (
          <span
            className="absolute left-2.5 top-2.5 rounded-full bg-white/92 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] backdrop-blur-sm"
            style={{ color: colors.brand }}
          >
            Shoop&apos;s pick
          </span>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 5,
          minWidth: 0,
          padding: isHero ? "12px 14px 10px" : "10px 12px 10px",
        }}
      >
        <div
          style={{
            fontSize: isHero ? 14 : 13,
            fontWeight: fontWeight.medium,
            color: colors.ink,
            lineHeight: 1.35,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {pick.title}
        </div>
        {price ? (
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: isHero ? 16 : 14,
                fontWeight: fontWeight.bold,
                color: colors.ink,
                letterSpacing: "-0.01em",
              }}
            >
              {price}
            </span>
            <RatingTag rating={pick.rating} size={isHero ? "sm" : "xs"} />
          </div>
        ) : (
          <RatingTag rating={pick.rating} size={isHero ? "sm" : "xs"} />
        )}
        <p
          style={{
            fontSize: isHero ? 12 : 11,
            lineHeight: 1.4,
            color: colors.inkSecondary,
            margin: 0,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {pick.reason}
        </p>
        {pick.caveat ? (
          <p
            style={{
              fontSize: isHero ? 11 : 10,
              lineHeight: 1.35,
              color: colors.inkMuted,
              margin: 0,
              fontWeight: fontWeight.medium,
            }}
          >
            ⚠ {pick.caveat}
          </p>
        ) : null}
      </div>
    </button>
    <div className="px-3 pb-3">
      <FittingRoomAction
        item={fittingRoomItemFromProductCard(pick)}
        compact={!isHero}
      />
    </div>
    <PickFindSimilarButton pick={pick} compact={!isHero} className="shrink-0" />
    </div>
  );
}

/** Simple vertical card for the horizontal gallery row. */
export function GalleryPickCard({ pick }: { pick: CuratedPick }) {
  const link = useProductCardAction(pick);
  const buyerCurrency = useBuyerDisplayCurrency();
  const price = formatPrice(pick, buyerCurrency);

  return (
    <div
      className={cn(
        "tp-alt-card relative shrink-0 snap-start overflow-hidden",
        link.className,
      )}
      style={{
        width: 164,
        background: colors.surface,
        border: `1px solid ${colors.hairline}`,
        borderRadius: radii.xl,
        boxShadow: shadows.soft,
      }}
    >
      <PickReplyButton pick={pick} className="absolute right-2 top-2 z-10" />
      <button
      type="button"
      id={link.id}
      onClick={link.onOpen}
      aria-expanded={link.isExpanded}
      className="w-full shrink-0 snap-start"
      data-testid={`gallery-pick-${pick.id}`}
      style={{
        width: "100%",
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        transition: "background-color 200ms",
        textAlign: "left",
      }}
    >
      <div style={{ position: "relative", width: "100%" }}>
        {pick.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={catalogDisplayImageUrl(pick.imageUrl, CATALOG_IMAGE_PX.scroll)}
            alt=""
            loading="lazy"
            decoding="async"
            style={{
              width: "100%",
              aspectRatio: "1",
              objectFit: "cover",
              background: colors.surfaceSubtle,
              display: "block",
            }}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            style={{
              width: "100%",
              aspectRatio: "1",
              background: colors.surfaceSubtle,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: colors.inkMuted,
              fontSize: 28,
              fontWeight: fontWeight.semibold,
            }}
            aria-hidden
          >
            {pick.title.charAt(0)}
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          minWidth: 0,
          padding: "10px 12px 8px",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: fontWeight.medium,
            color: colors.ink,
            lineHeight: 1.35,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {pick.title}
        </div>
        {price ? (
          <span
            style={{
              fontSize: 14,
              fontWeight: fontWeight.bold,
              color: colors.ink,
              letterSpacing: "-0.01em",
            }}
          >
            {price}
          </span>
        ) : null}
        <RatingTag rating={pick.rating} size="xs" />
        <p
          style={{
            fontSize: 11,
            lineHeight: 1.35,
            color: colors.inkSecondary,
            margin: 0,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {pick.reason}
        </p>
      </div>
    </button>
    <div className="px-3 pb-2">
      <FittingRoomAction item={fittingRoomItemFromProductCard(pick)} compact />
    </div>
    <PickFindSimilarButton pick={pick} compact />
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
 * Tall lead card for fashion funnel #1 — portrait Shopify crop (3:4).
 */
export function FashionLeadPickCard({
  product,
  fashionPickSignals,
}: {
  product: ProductCard;
  fashionPickSignals?: boolean;
}) {
  const link = useProductCardAction(product, { fashionPickSignals });
  const buyerCurrency = useBuyerDisplayCurrency();
  const price = formatPrice(product, buyerCurrency);

  return (
    <div
      className={cn(
        "tp-pick-card relative flex h-full min-h-0 w-full flex-col overflow-hidden",
        link.className,
      )}
      style={{
        background: colors.surface,
        border: `1px solid ${colors.hairline}`,
        boxShadow: shadows.card,
        borderRadius: radii.xl,
      }}
    >
      <button
        type="button"
        id={link.id}
        onClick={link.onOpen}
        aria-expanded={link.isExpanded}
        className="flex min-h-0 w-full flex-1 flex-col"
        data-testid="fashion-lead-pick"
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div
          className="relative w-full"
          style={{
            aspectRatio: "3 / 4",
            background: colors.surfaceSubtle,
          }}
        >
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={catalogDisplayImageUrl(product.imageUrl, CATALOG_IMAGE_PX.lead)}
              alt={product.title}
              decoding="async"
              fetchPriority="high"
              className="absolute inset-0 size-full object-cover object-top"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center text-[36px] font-semibold"
              style={{ color: colors.inkMuted }}
              aria-hidden
            >
              {product.title.charAt(0)}
            </div>
          )}
          <span
            className="absolute left-2.5 top-2.5 rounded-full bg-white/92 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] backdrop-blur-sm"
            style={{ color: colors.brand }}
          >
            Top find
          </span>
        </div>
        <div
          style={{
            padding: "10px 12px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: fontWeight.medium,
              color: colors.ink,
              lineHeight: 1.3,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {product.title}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            {price ? (
              <span
                style={{
                  fontSize: 15,
                  fontWeight: fontWeight.bold,
                  color: colors.ink,
                  letterSpacing: "-0.01em",
                }}
              >
                {price}
              </span>
            ) : null}
            <RatingTag rating={product.rating} size="xs" />
          </div>
        </div>
      </button>
      <div className="px-2 pb-2">
        <FittingRoomAction
          item={fittingRoomItemFromProductCard(product)}
          compact
        />
      </div>
      <PickFindSimilarButton pick={product} className="shrink-0" />
    </div>
  );
}

/**
 * Runner-up #2 / #3 — portrait Shopify thumb + text (matches catalog crop).
 */
export function FashionStackPickCard({
  product,
  rankLabel,
  fashionPickSignals,
}: {
  product: ProductCard;
  rankLabel: string;
  fashionPickSignals?: boolean;
}) {
  const link = useProductCardAction(product, { fashionPickSignals });
  const buyerCurrency = useBuyerDisplayCurrency();
  const price = formatPrice(product, buyerCurrency);

  return (
    <div
      className={cn(
        "tp-alt-card relative flex h-full min-h-0 w-full overflow-hidden",
        link.className,
      )}
      style={{
        background: colors.surface,
        border: `1px solid ${colors.hairline}`,
        borderRadius: radii.xl,
        boxShadow: shadows.soft,
      }}
    >
      <button
        type="button"
        id={link.id}
        onClick={link.onOpen}
        aria-expanded={link.isExpanded}
        className="grid h-full min-h-0 w-full grid-cols-[1fr_2fr]"
        data-testid="fashion-stack-pick"
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div
          className="relative min-h-[120px] overflow-hidden"
          style={{ background: colors.surfaceSubtle }}
        >
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={catalogDisplayImageUrl(product.imageUrl, CATALOG_IMAGE_PX.stack)}
              alt={product.title}
              decoding="async"
              className="absolute inset-0 size-full object-cover object-top"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center text-[22px] font-semibold"
              style={{ color: colors.inkMuted }}
              aria-hidden
            >
              {product.title.charAt(0)}
            </div>
          )}
        </div>
        <div
          style={{
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 4,
            padding: "10px 12px",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: fontWeight.semibold,
              letterSpacing: "0.1em",
              color: colors.inkMuted,
              textTransform: "uppercase",
            }}
          >
            {rankLabel}
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: fontWeight.medium,
              color: colors.ink,
              lineHeight: 1.3,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {product.title}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            {price ? (
              <span
                style={{
                  fontSize: 14,
                  fontWeight: fontWeight.bold,
                  color: colors.ink,
                  letterSpacing: "-0.01em",
                }}
              >
                {price}
              </span>
            ) : null}
            <RatingTag rating={product.rating} size="xs" />
          </div>
        </div>
      </button>
      <div className="px-2 pb-2">
        <FittingRoomAction
          item={fittingRoomItemFromProductCard(product)}
          compact
        />
      </div>
    </div>
  );
}

/** Compact square card for horizontal scroll rows (verified rest / overflow). */
export function ProductScrollCard({
  product,
  fashionPickSignals,
  muted,
}: {
  product: ProductCard;
  fashionPickSignals?: boolean;
  /** Soften unverified / overflow finds. */
  muted?: boolean;
}) {
  const link = useProductCardAction(product, { fashionPickSignals });
  const buyerCurrency = useBuyerDisplayCurrency();
  const price = formatPrice(product, buyerCurrency);

  return (
    <div
      className={cn(
        "tp-alt-card relative shrink-0 snap-start overflow-hidden",
        muted && "opacity-55",
        link.className,
      )}
      style={{
        width: 164,
        background: colors.surface,
        border: `1px solid ${muted ? colors.hairlineSoft : colors.hairline}`,
        borderRadius: radii.xl,
        boxShadow: muted ? undefined : shadows.soft,
      }}
    >
      <button
        type="button"
        id={link.id}
        onClick={link.onOpen}
        aria-expanded={link.isExpanded}
        className="w-full shrink-0 snap-start"
        data-testid="product-scroll-card"
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          textAlign: "left",
        }}
      >
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={catalogDisplayImageUrl(product.imageUrl, CATALOG_IMAGE_PX.scroll)}
            alt=""
            loading="lazy"
            decoding="async"
            style={{
              width: "100%",
              aspectRatio: "1",
              objectFit: "cover",
              background: colors.surfaceSubtle,
              display: "block",
            }}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            style={{
              width: "100%",
              aspectRatio: "1",
              background: colors.surfaceSubtle,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: colors.inkMuted,
              fontSize: 28,
              fontWeight: fontWeight.semibold,
            }}
            aria-hidden
          >
            {product.title.charAt(0)}
          </div>
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            minWidth: 0,
            padding: "10px 12px 12px",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: fontWeight.medium,
              color: muted ? colors.inkSoft : colors.ink,
              lineHeight: 1.35,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {product.title}
          </div>
          {price ? (
            <span
              style={{
                fontSize: 14,
                fontWeight: fontWeight.bold,
                color: muted ? colors.inkSoft : colors.ink,
                letterSpacing: "-0.01em",
              }}
            >
              {price}
            </span>
          ) : null}
        </div>
      </button>
      <div className="px-2 pb-2">
        <FittingRoomAction
          item={fittingRoomItemFromProductCard(product)}
          compact
        />
      </div>
    </div>
  );
}

export function SecondaryPickCard({
  product,
  fashionPickSignals,
}: {
  product: ProductCard;
  fashionPickSignals?: boolean;
}) {
  const link = useProductCardAction(product, { fashionPickSignals });
  const buyerCurrency = useBuyerDisplayCurrency();
  const price = formatPrice(product, buyerCurrency);

  return (
    <>
    <div
      className={cn(
        "tp-alt-card relative min-w-0 w-full overflow-hidden",
        link.className,
      )}
      style={{
        background: colors.surface,
        border: `1px solid ${colors.hairline}`,
        borderRadius: radii.xl,
        boxShadow: shadows.soft,
      }}
    >
    <button
      type="button"
      id={link.id}
      onClick={link.onOpen}
      aria-expanded={link.isExpanded}
      className="w-full"
      data-testid="secondary-pick"
      style={{
        width: "100%",
        background: "transparent",
        border: "none",
        padding: 12,
        cursor: "pointer",
        display: "flex",
        gap: 12,
        alignItems: "center",
        transition: "background-color 200ms",
        textAlign: "left",
      }}
    >
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={catalogDisplayImageUrl(product.imageUrl, CATALOG_IMAGE_PX.thumb)}
          alt={product.title}
          loading="lazy"
          decoding="async"
          style={{
            width: 72,
            height: 72,
            borderRadius: radii.lg,
            objectFit: "cover",
            flexShrink: 0,
            background: colors.surfaceSubtle,
          }}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: radii.lg,
            flexShrink: 0,
            background: colors.surfaceSubtle,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: colors.inkMuted,
            fontWeight: fontWeight.semibold,
          }}
          aria-hidden
        >
          {product.title.charAt(0)}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: fontWeight.semibold,
            letterSpacing: "0.08em",
            color: colors.inkMuted,
            textTransform: "uppercase",
            marginBottom: 4,
          }}
        >
          Also worth a look
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: fontWeight.medium,
            color: colors.ink,
            marginBottom: 2,
            lineHeight: 1.3,
          }}
        >
          {product.title}
        </div>
        {price ? (
          <span
            style={{
              fontSize: 15,
              fontWeight: fontWeight.bold,
              color: colors.ink,
            }}
          >
            {price}
          </span>
        ) : null}
      </div>
    </button>
    <div className="px-3 pb-2">
      <FittingRoomAction item={fittingRoomItemFromProductCard(product)} compact />
    </div>
    <PickFindSimilarButton pick={product} />
    </div>
    {link.isExpanded ? (
      <InlineChatProductPanel onClose={link.collapse} />
    ) : null}
    </>
  );
}
