"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  ExternalLink,
  Loader2,
  Minus,
  PackageCheck,
  Plus,
  Share2,
  ShoppingBag,
  Star,
  Store,
  X,
} from "lucide-react";
import {
  appendUtmToContinueUrlAction,
  getProductAction,
} from "@/actions/catalog";
import { useRouter } from "next/navigation";
import {
  collectCatalogImageUrls,
  isVariantStockPurchasable,
  resolveCatalogSeller,
  resolvePurchasableVariant,
  resolveSelectedPurchasableVariant,
  type CatalogProductDetail,
  type SelectedOption,
} from "@/lib/shopify/catalog";
import type { MerchantCommerceSupport } from "@/lib/shopify/merchant-support";
import { MERCHANT_MCP_UNSUPPORTED_MARKER } from "@/lib/shopify/mcp-parse";
import { useCartStore } from "@/components/cart/cart-store";
import {
  usePreloadedImage,
  usePreloadGalleryImages,
} from "@/components/commerce/use-product-gallery-image";
import { ProductCurationBanner } from "@/components/commerce/ProductCurationBanner";
import {
  ProductCurationInsightRow,
  ProductCurationInsightRowSkeleton,
  ProductCurationSidebarPanels,
  ProductCurationSidebarSkeleton,
} from "@/components/commerce/ProductCurationDetail";
import { CurationBannerSkeleton } from "@/components/commerce/ProductCurationBanner";
import { useProductCuration } from "@/components/commerce/use-product-curation";
import { useChatProductPick } from "@/components/chat/useChatProductPick";
import { productCurationFromChatPick } from "@/lib/ai-chat/curation/from-pick";
import { cartContainsVariant, variantIdsMatch } from "@/lib/cart/variant-id";
import { buildRyeProductUrl } from "@/lib/rye/product-url";
import {
  clearPendingCheckout,
  stashPendingCheckout,
} from "@/lib/client/pending-checkout";
import {
  isColorOptionName,
  isMonogramOptionName,
  isSizeOptionName,
  resolveStockStatus,
  selectionAvailabilitySignal,
  splitBrandTitle,
  type StockStatusDisplay,
} from "@/components/commerce/product-option-ui";
import { useSwatchColors } from "@/components/commerce/use-swatch-colors";
import { friendlyStoreName } from "@/lib/commerce/friendly-store-name";
import {
  LINK_COPIED_TOAST,
  SAVE_COMING_SOON_TOAST,
  WATCH_COMING_SOON_TOAST,
} from "@/lib/client/coming-soon-toasts";
import { useToastStore } from "@/lib/client/toast-store";
import { cn } from "@/lib/ai-chat/cn";
import { FittingRoomAction } from "@/components/tryon/FittingRoomAction";
import { fittingRoomItemFromPdp } from "@/components/tryon/fitting-room-item-builders";
import type { FittingRoomItem } from "@/lib/tryon/fitting-room-types";
import {
  EMPTY_USER_OPTION_HINTS,
  inferPreferredOptions,
  type ProductPriceRangeHint,
} from "@/lib/ai-chat/curation/preferred-options";
export type ProductPageViewProps = {
  productId: string;
  featuredVariantId?: string;
  fallbackTitle?: string;
  fallbackImageUrl?: string;
  prefilledOptions?: SelectedOption[];
  chatPriceRange?: ProductPriceRangeHint;
  onClose?: () => void;
};

type Phase = "loading" | "ready" | "error";

function formatPrice(amount: number, currency: string): string {
  const value = amount / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function merchantDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isAgenticUnsupported(err: unknown): boolean {
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return msg.includes(MERCHANT_MCP_UNSUPPORTED_MARKER);
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    return (
      err.message.replace(MERCHANT_MCP_UNSUPPORTED_MARKER, "").trim() ||
      fallback
    );
  }
  return fallback;
}

function variantBelowChatPrice(
  variant: { price?: { amount: number } } | null | undefined,
  chatPriceRange: ProductPriceRangeHint | undefined,
): boolean {
  const expectedMin = chatPriceRange?.min.amount;
  const actual = variant?.price?.amount;
  if (expectedMin == null || actual == null) return false;
  return actual < expectedMin * 0.75;
}

function mergeSelectedFromProduct(
  product: CatalogProductDetail,
  selected: SelectedOption[],
): Record<string, string> {
  const initial: Record<string, string> = {};
  for (const s of product.selected ?? []) initial[s.name] = s.label;
  for (const s of selected) initial[s.name] = s.label;
  for (const opt of product.options ?? []) {
    if (initial[opt.name]) continue;
    const available = opt.values.filter((v) => v.available !== false);
    if (available.length === 1) initial[opt.name] = available[0]!.label;
  }
  return initial;
}

function effectiveSelectedOptions(
  detail: CatalogProductDetail | null,
  selectedOptions: Record<string, string>,
): Record<string, string> {
  if (!detail) return selectedOptions;
  const merged = { ...selectedOptions };
  for (const s of detail.selected ?? []) {
    if (!merged[s.name]) merged[s.name] = s.label;
  }
  return merged;
}

export function ProductPageView({
  productId,
  featuredVariantId,
  fallbackTitle,
  fallbackImageUrl,
  prefilledOptions,
  chatPriceRange,
  onClose,
}: ProductPageViewProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [detail, setDetail] = useState<CatalogProductDetail | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<
    Record<string, string>
  >({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const fetchGenRef = useRef(0);
  const [optionsBusy, setOptionsBusy] = useState(false);
  const [quantity, setQuantity] = useState(1);

  const [agenticUnsupported, setAgenticUnsupported] = useState(false);
  const router = useRouter();
  const cart = useCartStore((s) => s.cart);
  const cartBusy = useCartStore((s) => s.mutating);
  const cartError = useCartStore((s) => s.error);
  const addCartItem = useCartStore((s) => s.addItem);
  const updateCartQuantity = useCartStore((s) => s.updateQuantity);
  const setDrawerOpen = useCartStore((s) => s.setDrawerOpen);
  const clearCartError = useCartStore((s) => s.clearError);

  const [handoffOpen, setHandoffOpen] = useState<"buy_now" | "cart" | null>(
    null,
  );
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [merchantSupport, setMerchantSupport] =
    useState<MerchantCommerceSupport | null>(null);
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportError, setSupportError] = useState<string | null>(null);

  const [galleryIndex, setGalleryIndex] = useState(0);

  const prefilledKey = useMemo(
    () => JSON.stringify(prefilledOptions ?? []),
    [prefilledOptions],
  );
  const chatPriceKey = useMemo(
    () => JSON.stringify(chatPriceRange ?? null),
    [chatPriceRange],
  );

  const catalogProductId =
    phase === "ready" && detail?.id ? detail.id : productId;
  const { pick: chatPick } = useChatProductPick(catalogProductId);
  const { curation: persistedCuration } = useProductCuration(
    phase === "ready" ? detail?.id : undefined,
  );
  // The user already saw this pick's verdict + reason in chat. Show it
  // immediately for continuity on the in-chat PDP.
  const chatCuration = chatPick
    ? productCurationFromChatPick(chatPick, catalogProductId)
    : null;
  const displayCuration = chatCuration ?? persistedCuration ?? null;
  const hasCuration = displayCuration != null;
  const isPersonalizing = false;
  const showCurationLoading = false;

  useEffect(() => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    const initialSelected = JSON.parse(prefilledKey) as SelectedOption[];
    const priceRange = JSON.parse(chatPriceKey) as ProductPriceRangeHint | null;
    const catalogLookupId =
      initialSelected.length > 0 ? productId : (featuredVariantId ?? productId);
    void (async () => {
      try {
        let selectedForFetch = initialSelected;
        let { product } = await getProductAction(
          catalogLookupId,
          selectedForFetch,
        );
        if (gen !== fetchGenRef.current) return;
        if (!product) {
          setLoadError("This product is no longer available.");
          setPhase("error");
          return;
        }

        if (
          initialSelected.length === 0 &&
          priceRange &&
          variantBelowChatPrice(product.variants?.[0], priceRange)
        ) {
          const inferred = inferPreferredOptions(
            { options: product.options, priceRange },
            "",
            undefined,
            EMPTY_USER_OPTION_HINTS,
          );
          if (inferred.length) {
            selectedForFetch = inferred;
            const retry = await getProductAction(productId, inferred);
            if (gen !== fetchGenRef.current) return;
            if (retry.product) product = retry.product;
          }
        }

        let mergedSelected = mergeSelectedFromProduct(
          product,
          selectedForFetch,
        );
        let selectedForResolved: SelectedOption[] = Object.entries(
          mergedSelected,
        ).map(([name, label]) => ({ name, label }));

        if (
          catalogLookupId !== productId &&
          !resolvePurchasableVariant(product)
        ) {
          const retry = await getProductAction(productId, selectedForFetch);
          if (gen !== fetchGenRef.current) return;
          if (retry.product) {
            product = retry.product;
            mergedSelected = mergeSelectedFromProduct(
              product,
              selectedForFetch,
            );
            selectedForResolved = Object.entries(mergedSelected).map(
              ([name, label]) => ({ name, label }),
            );
          }
        }

        const allPicked =
          !product.options?.length ||
          product.options.every((opt) => Boolean(mergedSelected[opt.name]));
        if (
          allPicked &&
          !resolvePurchasableVariant(product) &&
          selectedForResolved.length > 0
        ) {
          const retry = await getProductAction(productId, selectedForResolved);
          if (gen !== fetchGenRef.current) return;
          if (retry.product) {
            product = retry.product;
            mergedSelected = mergeSelectedFromProduct(
              product,
              selectedForResolved,
            );
          }
        }

        setDetail(product);
        setSelectedOptions(mergedSelected);
        setPhase("ready");
      } catch (e) {
        if (gen !== fetchGenRef.current) return;
        setLoadError(errorMessage(e, "Could not load product details."));
        setPhase("error");
      }
    })();
  }, [productId, featuredVariantId, prefilledKey, chatPriceKey]);

  const refreshWithSelected = useCallback(
    async (nextSel: Record<string, string>) => {
      fetchGenRef.current += 1;
      const gen = fetchGenRef.current;
      setOptionsBusy(true);
      try {
        const selected: SelectedOption[] = Object.entries(nextSel).map(
          ([name, label]) => ({ name, label }),
        );
        const { product } = await getProductAction(productId, selected);
        if (gen !== fetchGenRef.current) return;
        if (product) {
          setDetail(product);
          const merged: Record<string, string> = { ...nextSel };
          for (const s of product.selected ?? []) merged[s.name] = s.label;
          setSelectedOptions(merged);
        }
      } catch (e) {
        if (gen !== fetchGenRef.current) return;
        setLoadError(errorMessage(e, "Could not refresh variant options."));
      } finally {
        if (gen === fetchGenRef.current) setOptionsBusy(false);
      }
    },
    [productId],
  );

  const onPickOption = useCallback(
    (name: string, label: string) => {
      const next = { ...selectedOptions, [name]: label };
      setSelectedOptions(next);
      clearCartError();
      void refreshWithSelected(next);
    },
    [selectedOptions, clearCartError, refreshWithSelected],
  );

  const pickedOptions = useMemo(
    () => effectiveSelectedOptions(detail, selectedOptions),
    [detail, selectedOptions],
  );

  const allOptionsPicked = useMemo(() => {
    if (!detail?.options?.length) return true;
    return detail.options.every((opt) => Boolean(pickedOptions[opt.name]));
  }, [detail, pickedOptions]);

  const resolvedVariant = useMemo(
    () => resolveSelectedPurchasableVariant(detail, pickedOptions),
    [detail, pickedOptions],
  );

  useEffect(() => {
    const checkoutUrl = resolvedVariant?.checkout_url;
    const controller = new AbortController();
    void (async () => {
      setMerchantSupport(null);
      setSupportError(null);
      if (!checkoutUrl) {
        setSupportBusy(false);
        return;
      }

      setSupportBusy(true);
      try {
        const res = await fetch(
          `/api/shopify/merchant-support?checkoutUrl=${encodeURIComponent(checkoutUrl)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const body = (await res.json().catch(() => ({}))) as {
          support?: MerchantCommerceSupport;
          error?: string;
        };
        if (!res.ok || !body.support) {
          throw new Error(body.error ?? "Could not check merchant support.");
        }
        setMerchantSupport(body.support);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSupportError(
          error instanceof Error
            ? error.message
            : "Could not check merchant support.",
        );
      } finally {
        if (!controller.signal.aborted) setSupportBusy(false);
      }
    })();

    return () => controller.abort();
  }, [resolvedVariant?.checkout_url]);

  const galleryImages = useMemo(() => {
    const urls = collectCatalogImageUrls(detail, resolvedVariant ?? null);
    if (urls.length) return urls;
    if (fallbackImageUrl) return [fallbackImageUrl];
    return [];
  }, [detail, resolvedVariant, fallbackImageUrl]);

  const [trackedGalleryDeps, setTrackedGalleryDeps] = useState<{
    productId: string;
    length: number;
  }>({ productId, length: galleryImages.length });
  if (
    trackedGalleryDeps.productId !== productId ||
    trackedGalleryDeps.length !== galleryImages.length
  ) {
    setTrackedGalleryDeps({ productId, length: galleryImages.length });
    setGalleryIndex(0);
  }

  const productImage = galleryImages[galleryIndex] ?? galleryImages[0] ?? null;

  const catalogVariant = detail?.variants?.[0] ?? null;
  const { name: sellerName, domain: sellerDomain } = resolveCatalogSeller(
    detail,
    resolvedVariant ?? catalogVariant,
  );

  const selectedVariantInCart = Boolean(
    resolvedVariant?.id && cartContainsVariant(cart, resolvedVariant.id),
  );

  const cartProductMetadata = useMemo(() => {
    if (!resolvedVariant || !catalogProductId) return undefined;
    return {
      title: detail?.title ?? fallbackTitle ?? "Product",
      imageUrl: productImage ?? fallbackImageUrl ?? null,
      priceCents: resolvedVariant.price?.amount ?? null,
      currency: resolvedVariant.price?.currency ?? null,
      sellerName,
      sellerDomain,
      productId: catalogProductId,
      // Rye-ready URL (product page + ?variant=…) saved now so checkout never re-fetches.
      productUrl: detail ? buildRyeProductUrl(detail, resolvedVariant) : null,
    };
  }, [
    catalogProductId,
    detail,
    fallbackImageUrl,
    fallbackTitle,
    productImage,
    resolvedVariant,
    sellerName,
    sellerDomain,
  ]);

  const onAddToCart = useCallback(
    async (replaceExisting = false) => {
      if (!resolvedVariant) return;
      clearCartError();
      setAgenticUnsupported(false);
      const ok = await addCartItem({
        variantId: resolvedVariant.id,
        checkoutUrl: resolvedVariant.checkout_url!,
        quantity,
        replaceExisting,
        product: cartProductMetadata,
      });
      if (!ok) {
        const err = useCartStore.getState().error;
        if (isAgenticUnsupported(err)) {
          setAgenticUnsupported(true);
        }
      }
    },
    [
      addCartItem,
      cartProductMetadata,
      clearCartError,
      quantity,
      resolvedVariant,
    ],
  );

  const navigateToPreCheckout = useCallback(async () => {
    if (!resolvedVariant?.checkout_url || !allOptionsPicked) return;

    clearCartError();
    setAgenticUnsupported(false);

    const shopForCheckout =
      merchantDomain(resolvedVariant.checkout_url) ||
      merchantSupport?.shopDomain?.trim() ||
      sellerDomain?.trim();
    if (!shopForCheckout) return;

    stashPendingCheckout({
      shopDomain: shopForCheckout,
      variantId: resolvedVariant.id,
      productId: catalogProductId,
      quantity,
      checkoutUrl: resolvedVariant.checkout_url,
      product: cartProductMetadata ?? {
        title: detail?.title ?? fallbackTitle ?? "Product",
        productId: catalogProductId,
      },
    });

    // Persist (or refresh) the line on every Buy now so the Rye productUrl is
    // saved in the DB and available later from the cart drawer — even for lines
    // added before it was captured. replaceExisting sets the exact quantity.
    const ready = await addCartItem({
      variantId: resolvedVariant.id,
      checkoutUrl: resolvedVariant.checkout_url,
      quantity,
      replaceExisting: true,
      product: cartProductMetadata,
    });

    if (ready) {
      clearPendingCheckout();
      const latestCart = useCartStore.getState().cart;
      const shopFromCart =
        latestCart?.groups?.find((group) =>
          group.lineItems.some((line) =>
            variantIdsMatch(line.variantId, resolvedVariant.id),
          ),
        )?.shopDomain ?? null;
      const shop = shopFromCart?.trim() || shopForCheckout;
      setDrawerOpen(false);
      const params = new URLSearchParams({
        shop,
        variant: resolvedVariant.id,
        productId: catalogProductId,
      });
      router.push(`/pre-checkout?${params.toString()}`);
      return;
    }

    const err = useCartStore.getState().error;
    if (isAgenticUnsupported(err)) {
      // Merchant has no Cart MCP — pre-checkout can still run from the stashed
      // productUrl (Rye) or the catalog checkout URL (Shopify handoff).
      setDrawerOpen(false);
      const params = new URLSearchParams({
        shop: shopForCheckout,
        variant: resolvedVariant.id,
        productId: catalogProductId,
      });
      router.push(`/pre-checkout?${params.toString()}`);
      return;
    }
  }, [
    addCartItem,
    allOptionsPicked,
    cartProductMetadata,
    catalogProductId,
    clearCartError,
    detail?.title,
    fallbackTitle,
    merchantSupport?.shopDomain,
    quantity,
    resolvedVariant,
    router,
    sellerDomain,
    setDrawerOpen,
  ]);

  const onBuyNow = useCallback(() => {
    void navigateToPreCheckout();
  }, [navigateToPreCheckout]);

  const onConfirmHandoff = useCallback(async () => {
    if (!resolvedVariant) return;
    setHandoffBusy(true);
    setHandoffError(null);
    try {
      const target =
        handoffOpen === "cart" && cart?.continueUrl
          ? cart.continueUrl
          : resolvedVariant.checkout_url!;
      const { url } = await appendUtmToContinueUrlAction(target);
      window.open(url, "_blank", "noopener,noreferrer");
      setHandoffOpen(null);
    } catch (e) {
      setHandoffError(errorMessage(e, "Couldn’t open the merchant checkout."));
    } finally {
      setHandoffBusy(false);
    }
  }, [handoffOpen, cart, resolvedVariant]);

  const priceLabel = resolvedVariant?.price
    ? formatPrice(resolvedVariant.price.amount, resolvedVariant.price.currency)
    : null;

  const buyNowPriceLabel = resolvedVariant?.price
    ? formatPrice(
        resolvedVariant.price.amount * quantity,
        resolvedVariant.price.currency,
      )
    : null;

  const comparePrice: string | null = null;

  const optionGroups = useMemo(() => {
    const opts = detail?.options ?? [];
    const color = opts.filter((o) => isColorOptionName(o.name));
    const size = opts.filter((o) => isSizeOptionName(o.name));
    const monogram = opts.filter((o) => isMonogramOptionName(o.name));
    const other = opts.filter(
      (o) =>
        !isColorOptionName(o.name) &&
        !isSizeOptionName(o.name) &&
        !isMonogramOptionName(o.name),
    );
    return { color, size, monogram, other };
  }, [detail?.options]);

  const stockStatus = useMemo(() => {
    if (!detail) return null;
    const variantForStock = resolvedVariant ?? catalogVariant;
    return resolveStockStatus(variantForStock?.availability, {
      hasCheckoutUrl: Boolean(variantForStock?.checkout_url),
      selectionAvailable: selectionAvailabilitySignal(
        detail.options,
        pickedOptions,
      ),
    });
  }, [detail, catalogVariant, resolvedVariant, pickedOptions]);

  const sectionPx = "px-4 md:px-5";

  const showShoopPickBadge =
    hasCuration && displayCuration?.slot === "shoop_pick";
  const showBuyBadgeOnImage = hasCuration && displayCuration?.verdict === "buy";

  const fittingRoomItem = useMemo((): FittingRoomItem | null => {
    if (!detail) return null;
    const variant = resolvedVariant ?? catalogVariant;
    const preferredOptions = Object.entries(pickedOptions).map(
      ([name, label]) => ({ name, label }),
    );
    return fittingRoomItemFromPdp({
      productId: detail.id,
      title: detail.title,
      imageUrl: productImage ?? undefined,
      price: variant?.price,
      variantId: variant?.id,
      preferredOptions,
      featuredVariant:
        variant ?
          {
            id: variant.id,
            price: variant.price,
            checkoutUrl: variant.checkout_url,
            options: variant.options,
          }
        : undefined,
    });
  }, [catalogVariant, detail, pickedOptions, productImage, resolvedVariant]);

  const purchaseSidebarProps = {
    priceLabel,
    comparePrice,
    sellerDomain,
    sellerName,
    stockStatus,
    curation: displayCuration,
    showCurationLoading,
    personalizing: isPersonalizing,
    quantity,
    onQuantityChange: setQuantity,
    showInlineCtAs: true as const,
    fittingRoomItem,
    purchaseActions: {
      resolvedVariant,
      allOptionsPicked,
      optionsBusy,
      cartBusy,
      hasCart: selectedVariantInCart,
      agenticUnsupported,
      merchantSupport,
      supportBusy,
      buyNowPriceLabel,
      stockStatus,
      onAddToCart: () => void onAddToCart(),
      onBuyNow,
    },
  };

  const hasVariantOptions =
    optionGroups.color.length +
      optionGroups.size.length +
      optionGroups.monogram.length +
      optionGroups.other.length >
    0;

  return (
    <div className="flex w-full flex-col overflow-visible bg-page">
      <div className="flex w-full flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-2.5 md:px-5">
          {onClose ? (
            <>
              <p className="text-sm font-semibold text-ink">Product details</p>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close product details"
                className="inline-flex size-9 items-center justify-center rounded-[10px] text-ink-soft transition hover:bg-surface-tint hover:text-ink"
              >
                <X className="size-5" aria-hidden />
              </button>
            </>
          ) : (
            <p className="text-sm font-semibold text-ink">Product details</p>
          )}
        </div>

        {phase === "loading" ? (
          <LoadingState fallbackTitle={fallbackTitle} />
        ) : phase === "error" ? (
          <ErrorState
            message={loadError ?? "Unknown error."}
            onClose={onClose}
          />
        ) : detail ? (
          <>
            <div className="pb-4">
              <section className="px-4 pt-3 md:px-5">
                <div className="grid w-full grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <ProductHeroGallery
                    images={galleryImages}
                    activeIndex={galleryIndex}
                    onSelect={setGalleryIndex}
                    title={detail.title}
                    activeImageUrl={productImage}
                    switching={optionsBusy}
                    onClose={onClose}
                    showPickBadge={showShoopPickBadge}
                    showBuyBadge={showBuyBadgeOnImage}
                  />
                  <PurchaseSidebar
                    className="hidden w-full shrink-0 flex-col gap-2 lg:flex"
                    {...purchaseSidebarProps}
                  />
                </div>
              </section>

              <section className={cn("relative z-10 mt-6", sectionPx)}>
                <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
                  <ProductIdentityBlock detail={detail} />
                  {hasVariantOptions ? (
                    <ProductVariantOptionsPanel
                      productId={detail.id}
                      optionGroups={optionGroups}
                      selectedOptions={selectedOptions}
                      optionsBusy={optionsBusy}
                      resolveSwatchColors
                      onPick={onPickOption}
                    />
                  ) : null}
                </div>

                {showCurationLoading ? (
                  <div className="hidden lg:block">
                    <ProductCurationInsightRowSkeleton />
                  </div>
                ) : hasCuration && displayCuration ? (
                  <div className="hidden lg:block">
                    <ProductCurationInsightRow
                      curation={displayCuration}
                      personalizing={isPersonalizing}
                    />
                  </div>
                ) : null}
              </section>

              <section className={cn("mt-6 space-y-4 lg:hidden", sectionPx)}>
                <PurchaseSidebar
                  className="flex w-full flex-col gap-2"
                  {...purchaseSidebarProps}
                />
              </section>

              <section className={cn("mt-6 space-y-4", sectionPx)}>
                {showCurationLoading ? (
                  <CurationBannerSkeleton />
                ) : !hasCuration ? (
                  <ProductCurationBanner productId={detail.id} />
                ) : null}

                <CommerceSupportPanel
                  support={merchantSupport}
                  busy={supportBusy}
                  error={supportError}
                />

                {detail.description?.html ? (
                  <div
                    className="prose prose-sm max-w-none text-ink-soft [&_p]:mb-2"
                    dangerouslySetInnerHTML={{
                      __html: detail.description.html,
                    }}
                  />
                ) : detail.description?.text ? (
                  <p className="whitespace-pre-line text-sm text-ink-soft">
                    {detail.description.text}
                  </p>
                ) : null}

                {selectedVariantInCart ? (
                  <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    <PackageCheck className="mt-0.5 size-4 shrink-0" />
                    <span>
                      This item is in your cart. Tap the bag icon at the top to
                      review or checkout.
                    </span>
                  </div>
                ) : null}

                {cartError ? (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {agenticUnsupported
                        ? "This item can’t be added to your cart — use Buy now instead."
                        : errorMessage(
                            cartError,
                            "Couldn’t update your cart. Try again.",
                          )}
                    </span>
                  </div>
                ) : null}

              </section>

              {showCurationLoading ? (
                <section className={cn("mt-6 lg:hidden", sectionPx)}>
                  <ProductCurationInsightRowSkeleton />
                </section>
              ) : hasCuration && displayCuration ? (
                <section className={cn("mt-6 lg:hidden", sectionPx)}>
                  <ProductCurationInsightRow
                    curation={displayCuration}
                    personalizing={isPersonalizing}
                  />
                </section>
              ) : null}
            </div>
          </>
        ) : null}

        {handoffOpen ? (
          <HandoffConfirm
            mode={handoffOpen}
            domain={
              handoffOpen === "cart"
                ? (merchantDomain(cart?.continueUrl) ?? sellerDomain)
                : sellerDomain
            }
            busy={handoffBusy}
            error={handoffError}
            onCancel={() => {
              setHandoffOpen(null);
              setHandoffError(null);
            }}
            onConfirm={() => void onConfirmHandoff()}
          />
        ) : null}
      </div>
    </div>
  );
}

function LoadingState({
  fallbackTitle,
}: {
  fallbackTitle?: string;
}) {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="flex flex-col items-center gap-3 text-ink-muted">
        <Loader2 className="size-7 animate-spin" />
        <p className="text-sm">
          Loading {fallbackTitle ? `"${fallbackTitle}"` : "product"}…
        </p>
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onClose,
}: {
  message: string;
  onClose?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <AlertTriangle className="size-8 text-warning" />
      <p className="max-w-md text-sm text-ink-soft">{message}</p>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="btn-primary px-6"
        >
          Close
        </button>
      ) : null}
    </div>
  );
}

function ProductHeroGallery({
  images,
  activeIndex,
  onSelect,
  title,
  activeImageUrl,
  switching = false,
  onClose,
  showPickBadge,
  showBuyBadge,
}: {
  images: string[];
  activeIndex: number;
  onSelect: (i: number) => void;
  title: string;
  activeImageUrl: string | null;
  switching?: boolean;
  onClose?: () => void;
  showPickBadge: boolean;
  showBuyBadge: boolean;
}) {
  usePreloadGalleryImages(images);
  const { displayUrl, pending } = usePreloadedImage(activeImageUrl);
  const showLoading = switching || pending;

  const goPrev = () =>
    onSelect((activeIndex - 1 + images.length) % images.length);
  const goNext = () => onSelect((activeIndex + 1) % images.length);

  const hasThumbs = images.length > 1;

  return (
    <div
      className={cn(
        "grid w-full min-w-0 gap-3",
        hasThumbs
          ? "grid-cols-1 lg:grid-cols-[64px_minmax(0,1fr)] lg:items-center lg:gap-6"
          : "grid-cols-1",
      )}
    >
      {hasThumbs ? (
        <div
          className={cn(
            "order-2 flex min-h-0 gap-2 overflow-x-auto pb-1",
            "lg:order-none lg:max-h-[22rem] lg:flex-col lg:items-center lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0",
            "[scrollbar-width:thin] [scrollbar-color:rgb(229_231_235)_transparent]",
          )}
        >
          {images.map((url, i) => (
            <button
              key={`${url}-${i}`}
              type="button"
              onClick={() => onSelect(i)}
              disabled={switching}
              aria-label={`View image ${i + 1}`}
              aria-current={i === activeIndex ? "true" : undefined}
              className={cn(
                "size-16 shrink-0 overflow-hidden rounded-[10px] bg-[#fafafa] transition disabled:opacity-60",
                i === activeIndex
                  ? "border-2 border-ink"
                  : "border border-[#e5e5e5]",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className="size-full object-cover"
                referrerPolicy="no-referrer"
              />
            </button>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          "order-1 flex min-w-0 flex-col gap-2 lg:order-none",
          hasThumbs && "lg:col-start-2",
        )}
      >
        {showPickBadge ? (
          <div className="shrink-0">
            <p className="text-sm font-bold uppercase tracking-wide text-brand">
              Shoop&apos;s pick
            </p>
            <p className="mt-0.5 text-[13px] text-ink-secondary">
              Personalized for you
            </p>
          </div>
        ) : null}

        <div className="relative aspect-[4/5] min-h-[220px] max-h-[min(420px,70vw)] w-full shrink-0 overflow-hidden rounded-[28px] bg-white shadow-soft sm:aspect-[5/6]">
          {displayUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayUrl}
              alt={title}
              className={cn(
                "block size-full object-contain p-6 transition-opacity duration-200 md:p-8",
                showLoading ? "opacity-75" : "opacity-100",
              )}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <ShoppingBag className="size-16 text-ink-muted" />
            </div>
          )}

          {showBuyBadge ? (
            <span className="absolute left-6 top-6 inline-flex w-fit rounded-full bg-success px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Buy
            </span>
          ) : null}

          {images.length > 1 ? (
            <>
              <button
                type="button"
                onClick={goPrev}
                aria-label="Previous image"
                className="absolute left-4 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 shadow-sm transition hover:bg-white"
              >
                <ChevronLeft className="size-5 text-ink-muted" />
              </button>
              <button
                type="button"
                onClick={goNext}
                aria-label="Next image"
                className="absolute right-4 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 shadow-sm transition hover:bg-white"
              >
                <ChevronRight className="size-5 text-ink-muted" />
              </button>
              <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-1.5">
                {images.map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "size-1.5 rounded-full",
                      i === activeIndex ? "bg-ink" : "bg-surface-tint",
                    )}
                    aria-hidden
                  />
                ))}
              </div>
            </>
          ) : null}

          {showLoading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[1px]">
              <Loader2 className="size-8 animate-spin text-ink-muted" />
            </div>
          ) : null}
        </div>

        <GalleryActionsBar onClose={onClose} />
      </div>
    </div>
  );
}

function GalleryActionsBar({
  onClose,
}: {
  onClose?: () => void;
}) {
  const showToast = useToastStore((s) => s.show);

  const onShare = useCallback(async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      showToast(LINK_COPIED_TOAST);
    } catch {
      showToast({
        title: "Couldn't copy link",
        body: "Try copying the address from your browser bar.",
      });
    }
  }, [showToast]);

  const onSkip = useCallback(() => {
    onClose?.();
  }, [onClose]);

  return (
    <div className="flex flex-wrap items-center justify-end gap-4 pt-1 sm:gap-5">
      <GalleryAction
        icon={Bookmark}
        label="Save"
        onClick={() => showToast(SAVE_COMING_SOON_TOAST)}
      />
      <GalleryAction
        icon={Eye}
        label="Watch"
        accent
        onClick={() => showToast(WATCH_COMING_SOON_TOAST)}
      />
      <GalleryAction
        icon={Share2}
        label="Share"
        onClick={() => void onShare()}
      />
      <GalleryAction icon={X} label="Skip" onClick={onSkip} />
    </div>
  );
}

function GalleryAction({
  icon: Icon,
  label,
  accent,
  onClick,
}: {
  icon: typeof Bookmark;
  label: string;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg px-1 py-1 text-[11px] font-bold uppercase tracking-wide text-ink transition hover:bg-surface-tint"
    >
      <Icon
        className={cn("size-4", accent ? "text-brand" : "text-ink")}
        aria-hidden
      />
      {label}
    </button>
  );
}

function formatReviewCount(count: number): string {
  try {
    return new Intl.NumberFormat(undefined).format(count);
  } catch {
    return String(count);
  }
}

function formatRatingValue(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function ProductIdentityBlock({ detail }: { detail: CatalogProductDetail }) {
  const split = splitBrandTitle(detail.title);
  const brand = detail.brand ?? split.brand;
  const productName = detail.brand
    ? split.productName || detail.title
    : split.productName || detail.title;
  const rating = detail.rating;

  return (
    <div className="min-w-0">
      {brand ? (
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
          {brand}
        </p>
      ) : null}
      <h1
        className={cn(
          "font-display text-[1.75rem] font-extrabold leading-tight tracking-[-0.025em] text-ink md:text-[2rem]",
          brand ? "mt-1.5" : "",
        )}
      >
        {productName}
      </h1>
      {rating ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-ink">
          <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden />
          <span className="font-semibold">
            {formatRatingValue(rating.value)}
          </span>
          <span className="text-ink-secondary">
            ({formatReviewCount(rating.count)} review
            {rating.count === 1 ? "" : "s"})
          </span>
        </p>
      ) : null}
    </div>
  );
}

function ProductVariantOptionsPanel({
  productId,
  optionGroups,
  selectedOptions,
  optionsBusy,
  resolveSwatchColors = false,
  onPick,
}: {
  productId: string;
  optionGroups: {
    color: NonNullable<CatalogProductDetail["options"]>;
    size: NonNullable<CatalogProductDetail["options"]>;
    monogram: NonNullable<CatalogProductDetail["options"]>;
    other: NonNullable<CatalogProductDetail["options"]>;
  };
  selectedOptions: Record<string, string>;
  optionsBusy: boolean;
  resolveSwatchColors?: boolean;
  onPick: (name: string, label: string) => void;
}) {
  const allOptions = [
    ...optionGroups.color,
    ...optionGroups.size,
    ...optionGroups.monogram,
    ...optionGroups.other,
  ];

  if (!allOptions.length) return null;

  const colorLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const opt of optionGroups.color) {
      for (const v of opt.values) labels.add(v.label);
    }
    return [...labels];
  }, [optionGroups.color]);
  const { colors: swatchColors, isResolving: swatchColorsResolving } =
    useSwatchColors(colorLabels, {
      productId,
      enabled: resolveSwatchColors,
    });

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {optionGroups.color.map((opt) => (
        <ColorOptionGroup
          key={opt.name}
          name={opt.name}
          selectedLabel={selectedOptions[opt.name]}
          values={opt.values}
          swatchColors={swatchColors}
          swatchColorsResolving={swatchColorsResolving}
          optionsBusy={optionsBusy}
          onPick={onPick}
        />
      ))}
      {optionGroups.size.map((opt) => (
        <SizeOptionGroup
          key={opt.name}
          name={opt.name}
          selectedLabel={selectedOptions[opt.name]}
          values={opt.values}
          optionsBusy={optionsBusy}
          onPick={onPick}
        />
      ))}
      {[...optionGroups.monogram, ...optionGroups.other].map((opt) => (
        <DefaultOptionGroup
          key={opt.name}
          name={opt.name}
          selectedLabel={selectedOptions[opt.name]}
          values={opt.values}
          optionsBusy={optionsBusy}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

function ColorOptionGroup({
  name,
  selectedLabel,
  values,
  swatchColors,
  swatchColorsResolving = false,
  optionsBusy,
  onPick,
}: {
  name: string;
  selectedLabel?: string;
  values: Array<{ label: string; available?: boolean; exists?: boolean }>;
  swatchColors: Record<string, string>;
  swatchColorsResolving?: boolean;
  optionsBusy: boolean;
  onPick: (name: string, label: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-secondary">
          {name}:
        </span>
        {selectedLabel ? (
          <span className="text-[13px] font-semibold text-ink">
            {selectedLabel}
          </span>
        ) : null}
        {swatchColorsResolving ? (
          <span
            className="text-[10px] font-medium uppercase tracking-[0.06em] text-ink-muted"
            role="status"
            aria-live="polite"
          >
            Matching colors…
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-3">
        {values.map((v) => {
          const on = selectedLabel === v.label;
          const notExists = v.exists === false;
          return (
            <button
              key={`${name}-${v.label}`}
              type="button"
              disabled={optionsBusy || notExists}
              aria-label={v.label}
              aria-busy={swatchColorsResolving}
              aria-pressed={on}
              onClick={() => onPick(name, v.label)}
              className={cn(
                "relative size-8 rounded-full border border-hairline transition disabled:cursor-not-allowed disabled:opacity-30",
                on && "ring-2 ring-white ring-offset-2 ring-offset-brand",
                notExists && "opacity-30",
                swatchColorsResolving &&
                  "animate-pulse motion-reduce:animate-none",
              )}
              style={{ background: swatchColors[v.label] }}
            >
              {swatchColorsResolving ? (
                <span
                  className="absolute inset-0 rounded-full bg-white/25"
                  aria-hidden
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SizeOptionGroup({
  name,
  selectedLabel,
  values,
  optionsBusy,
  onPick,
}: {
  name: string;
  selectedLabel?: string;
  values: Array<{ label: string; available?: boolean; exists?: boolean }>;
  optionsBusy: boolean;
  onPick: (name: string, label: string) => void;
}) {
  const label = selectedLabel
    ? `${name}: ${selectedLabel}`
    : name.toUpperCase();

  return (
    <div className="min-w-0 flex-[2]">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-secondary">
          {label}
        </span>
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {values.map((v) => {
          const on = selectedLabel === v.label;
          const notExists = v.exists === false;
          const unavailable = v.available === false && !notExists;
          return (
            <button
              key={`${name}-${v.label}`}
              type="button"
              disabled={optionsBusy || notExists}
              onClick={() => onPick(name, v.label)}
              className={cn(
                "h-9 min-w-[44px] shrink-0 rounded-full border px-3 text-[13px] transition disabled:cursor-not-allowed",
                on
                  ? "border-ink bg-ink font-semibold text-white"
                  : "border-hairline bg-white text-ink",
                (notExists || unavailable) && "opacity-30",
              )}
            >
              {v.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DefaultOptionGroup({
  name,
  selectedLabel,
  values,
  optionsBusy,
  onPick,
}: {
  name: string;
  selectedLabel?: string;
  values: Array<{ label: string; available?: boolean; exists?: boolean }>;
  optionsBusy: boolean;
  onPick: (name: string, label: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-secondary">
          {name}
          {selectedLabel ? `: ${selectedLabel}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {values.map((v) => {
          const on = selectedLabel === v.label;
          const notExists = v.exists === false;
          return (
            <button
              key={`${name}-${v.label}`}
              type="button"
              disabled={optionsBusy || notExists}
              onClick={() => onPick(name, v.label)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
                on
                  ? "border-ink bg-ink font-semibold text-white"
                  : "border-hairline bg-white text-ink-soft hover:border-ink/30",
              )}
            >
              {v.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type PurchaseActionsProps = {
  resolvedVariant: NonNullable<CatalogProductDetail["variants"]>[number] | null;
  allOptionsPicked: boolean;
  optionsBusy: boolean;
  cartBusy: boolean;
  hasCart: boolean;
  agenticUnsupported: boolean;
  merchantSupport: MerchantCommerceSupport | null;
  supportBusy: boolean;
  buyNowPriceLabel: string | null;
  stockStatus: StockStatusDisplay | null;
  onAddToCart: () => void;
  onBuyNow: () => void;
};

function StockStatusRow({ status }: { status: StockStatusDisplay }) {
  const dotClass =
    status.tone === "out_of_stock"
      ? "bg-rose-500"
      : status.tone === "low_stock"
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div className="flex items-center gap-2 py-0.5" role="status">
      <span
        className={cn("size-1.5 shrink-0 rounded-full", dotClass)}
        aria-hidden
      />
      <span className="text-xs leading-snug text-ink">{status.label}</span>
    </div>
  );
}

/** Store + stock sit directly above curation / locked personalization. */
function ProductCommerceMeta({
  sellerName,
  sellerDomain,
  stockStatus,
}: {
  sellerName: string | null;
  sellerDomain: string | null;
  stockStatus: StockStatusDisplay | null;
}) {
  const storeLabel =
    sellerName ?? (sellerDomain ? friendlyStoreName(sellerDomain) : null);
  if (!storeLabel && !stockStatus) return null;

  return (
    <>
      {storeLabel ? (
        <p className="text-[11px] text-ink-muted">Found at {storeLabel}</p>
      ) : null}
      {stockStatus ? <StockStatusRow status={stockStatus} /> : null}
    </>
  );
}

function PurchaseSidebar({
  className,
  priceLabel,
  comparePrice,
  sellerDomain,
  sellerName,
  stockStatus,
  curation,
  showCurationLoading = false,
  personalizing = false,
  quantity,
  onQuantityChange,
  showInlineCtAs,
  showShoopPickBadge = false,
  fittingRoomItem,
  purchaseActions,
}: {
  className?: string;
  priceLabel: string | null;
  comparePrice: string | null;
  sellerDomain: string | null;
  sellerName: string | null;
  stockStatus: StockStatusDisplay | null;
  curation: ReturnType<typeof useProductCuration>["curation"];
  showCurationLoading?: boolean;
  personalizing?: boolean;
  quantity: number;
  onQuantityChange: (n: number) => void;
  showInlineCtAs: boolean;
  showShoopPickBadge?: boolean;
  fittingRoomItem?: FittingRoomItem | null;
  purchaseActions: PurchaseActionsProps;
}) {
  return (
    <aside className={cn("min-w-0 overflow-hidden", className)}>
      <div className="flex flex-col gap-3">
        {showShoopPickBadge ? (
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-brand">
              Shoop&apos;s pick
            </p>
            <p className="mt-0.5 text-[13px] text-ink-secondary">
              Personalized for you
            </p>
          </div>
        ) : null}

        <div>
          <div className="flex items-baseline gap-2">
            {priceLabel ? (
              <span className="text-display-lg font-extrabold leading-none text-ink">
                {priceLabel}
              </span>
            ) : null}
            {comparePrice ? (
              <span className="text-base text-ink-muted line-through">
                {comparePrice}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-b border-hairline pb-3">
          <ProductCommerceMeta
            sellerName={sellerName}
            sellerDomain={sellerDomain}
            stockStatus={stockStatus}
          />
        </div>

        {showCurationLoading ? (
          <ProductCurationSidebarSkeleton />
        ) : curation ? (
          <ProductCurationSidebarPanels
            curation={curation}
            personalizing={personalizing}
          />
        ) : null}

        <QuantityStepper quantity={quantity} onChange={onQuantityChange} />
        {showInlineCtAs ? <PurchaseButtons {...purchaseActions} /> : null}
        {fittingRoomItem ? (
          <FittingRoomAction item={fittingRoomItem} className="w-full justify-center" />
        ) : null}
      </div>
    </aside>
  );
}

function QuantityStepper({
  quantity,
  onChange,
}: {
  quantity: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-secondary">
        Qty
      </span>
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => onChange(Math.max(1, quantity - 1))}
        className="flex size-7 items-center justify-center rounded-md border border-hairline bg-white"
      >
        <Minus className="size-3 text-ink" />
      </button>
      <span className="min-w-6 text-center text-xs font-semibold">
        {quantity}
      </span>
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => onChange(quantity + 1)}
        className="flex size-7 items-center justify-center rounded-md border border-hairline bg-white"
      >
        <Plus className="size-3 text-ink" />
      </button>
    </div>
  );
}

function PurchaseButtons({
  resolvedVariant,
  allOptionsPicked,
  optionsBusy,
  cartBusy,
  hasCart,
  agenticUnsupported,
  merchantSupport,
  supportBusy,
  buyNowPriceLabel,
  stockStatus,
  onAddToCart,
  onBuyNow,
}: PurchaseActionsProps) {
  const outOfStock = stockStatus?.tone === "out_of_stock";
  const variantPurchasable = isVariantStockPurchasable(resolvedVariant);
  const blocked =
    !resolvedVariant ||
    !allOptionsPicked ||
    optionsBusy ||
    cartBusy ||
    outOfStock ||
    !variantPurchasable;
  const addToCartExplicitlyUnsupported =
    merchantSupport?.cartSupported === false;
  const addBlocked =
    blocked ||
    cartBusy ||
    hasCart ||
    agenticUnsupported ||
    addToCartExplicitlyUnsupported;

  const buyLabel = buyNowPriceLabel
    ? `Buy now — ${buyNowPriceLabel}`
    : "Buy now";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={blocked}
        onClick={onBuyNow}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-[13px] font-semibold text-white transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {cartBusy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : null}
        {buyLabel}
      </button>
      <button
        type="button"
        disabled={addBlocked}
        onClick={onAddToCart}
        className={cn(
          "inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
          hasCart
            ? "border-success/30 bg-success-tint text-success-dark"
            : "border-ink bg-white text-ink hover:bg-surface-tint",
        )}
      >
        {cartBusy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : null}
        {hasCart
          ? "In cart"
          : addToCartExplicitlyUnsupported
            ? "Cart unavailable"
            : "Add to cart"}
      </button>
    </div>
  );
}

function CommerceSupportPanel({
  support,
  busy,
  error,
}: {
  support: MerchantCommerceSupport | null;
  busy: boolean;
  error: string | null;
}) {
  if (busy) return null;

  if (!support?.cartSupported) {
    if (error || !support) return null;
    return (
      <div className="flex items-start gap-2 rounded-xl border border-hairline bg-surface-tint px-3 py-2 text-xs text-ink-soft">
        <ExternalLink className="mt-0.5 size-4 shrink-0" />
        <span>
          This item can&apos;t be added to your Shoop cart — use Buy now to
          purchase it on the store&apos;s site.
        </span>
      </div>
    );
  }

  return null;
}

function HandoffConfirm({
  mode,
  domain,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  mode: "buy_now" | "cart";
  domain: string | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const title =
    mode === "cart" ? "Continue on the store’s website" : "Open checkout";
  const body =
    mode === "cart"
      ? "We’ll open the store in a new tab so you can review shipping, taxes, and complete payment."
      : "We’ll open checkout in a new tab. You’ll enter payment and delivery details on the store’s website.";
  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
        <div className="border-b border-hairline bg-surface-subtle/80 px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-tint text-ink">
              <ExternalLink className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold tracking-tight text-ink">
                {title}
              </h3>
              <p className="mt-1 text-sm leading-5 text-ink-secondary">
                {body}
              </p>
              {domain ? (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-hairline bg-white px-3 py-1 text-xs font-medium text-ink-soft">
                  <Store className="size-3.5" aria-hidden />
                  {domain}
                </p>
              ) : null}
              {error ? (
                <p className="mt-3 rounded-xl border border-error-border bg-error-bg px-3 py-2 text-xs text-error-deep">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-secondary h-11 px-5 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="btn-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {domain ? `Continue to ${friendlyStoreName(domain)}` : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
