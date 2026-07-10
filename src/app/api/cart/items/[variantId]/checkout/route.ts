import { getBuyerIpForShopifyMcp } from "@/lib/request-buyer-ip";
import { normalizeShopifyCountryInput } from "@/lib/cart/countries";
import { normalizeRegionInput } from "@/lib/cart/regions";
import { getCartGroupForCheckout } from "@/lib/cart/service";
import { cartGroupCheckoutSchema } from "@/lib/cart/validators";
import type { CartGroupCheckoutResponse, CheckoutAddressInput } from "@/lib/cart/types";
import { variantIdsMatch } from "@/lib/cart/variant-id";
import { mintGlobalApiAccessToken } from "@/lib/shopify/auth";
import { createCheckout } from "@/lib/shopify/checkout";
import {
  buildStorefrontHandoffCheckoutResponse,
  checkoutMessageFromMcpError,
  friendlyCheckoutError,
  isCheckoutStorefrontHandoff,
} from "@/lib/shopify/checkout-errors";
import { buildCreateCheckoutResponse } from "@/lib/shopify/checkout-api";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ variantId: string }> };

function pruneAddress(address: CheckoutAddressInput | undefined): CheckoutAddressInput | undefined {
  if (!address) return undefined;
  const out: CheckoutAddressInput = {};
  const normalizedCountry = address.addressCountry
    ? normalizeShopifyCountryInput(address.addressCountry)
    : undefined;
  for (const [key, value] of Object.entries(address) as Array<
    [keyof CheckoutAddressInput, string | undefined]
  >) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    if (key === "addressCountry") out[key] = normalizeShopifyCountryInput(trimmed);
    else if (key === "addressRegion") out[key] = normalizeRegionInput(normalizedCountry, trimmed);
    else out[key] = trimmed;
  }
  return Object.keys(out).length ? out : undefined;
}

export async function POST(req: Request, ctx: Ctx) {
  let shopDomain = "";
  let checkoutMode: CartGroupCheckoutResponse["mode"] = "agentic";
  let fallbackContinueUrl: string | undefined;
  let accessToken: string | undefined;

  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const { variantId: rawVariantId } = await ctx.params;
    const variantId = decodeURIComponent(rawVariantId);
    shopDomain = new URL(req.url).searchParams.get("shop") ?? "";
    if (!shopDomain) {
      return Response.json({ error: "Missing shop domain." }, { status: 400 });
    }

    const raw = await req.json();
    const parsed = cartGroupCheckoutSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid body.", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    checkoutMode = parsed.data.mode;

    const [{ session, group, cart }, buyerIp, tokenInfo] = await Promise.all([
      getCartGroupForCheckout(userId, shopDomain),
      getBuyerIpForShopifyMcp(),
      mintGlobalApiAccessToken(),
    ]);
    accessToken = tokenInfo.access_token;

    if (!session || !group?.hasCart || !cart) {
      return Response.json({ error: "Cart item not found." }, { status: 404 });
    }
    fallbackContinueUrl = group.continueUrl ?? session.checkoutUrl;
    if (!group.checkout.checkoutSupported) {
      return Response.json(
        { error: "This store does not support single-product agent checkout yet." },
        { status: 409 },
      );
    }

    const line = group.lineItems.find((item) => variantIdsMatch(item.variantId, variantId));
    if (!line) {
      return Response.json({ error: "Cart item not found." }, { status: 404 });
    }

    const checkout = await createCheckout(
      accessToken,
      session.cartId,
      session.checkoutUrl,
      buyerIp,
      {
        buyerEmail: parsed.data.buyerEmail?.trim() || undefined,
        shippingAddress: pruneAddress(parsed.data.shippingAddress),
        cart,
      },
    );
    const built = buildCreateCheckoutResponse({
      shopDomain,
      mode: parsed.data.mode,
      checkout,
      fallbackContinueUrl: fallbackContinueUrl!,
      groupContinueUrl: group.continueUrl ?? cart.continue_url,
    });
    if (!built.ok) {
      const { failure } = built;
      return Response.json(
        {
          error: failure.error,
          code: failure.code,
          severity: failure.severity,
          content: failure.content,
        },
        { status: failure.status },
      );
    }
    return Response.json({ checkout: built.checkout });
  } catch (error) {
    if (error instanceof Error) {
      const friendly = friendlyCheckoutError(error);
      if (isCheckoutStorefrontHandoff(friendly) && fallbackContinueUrl) {
        return Response.json({
          checkout: buildStorefrontHandoffCheckoutResponse({
            shopDomain,
            mode: checkoutMode,
            continueUrl: fallbackContinueUrl,
            message: checkoutMessageFromMcpError(friendly),
          }),
        });
      }
      const recoverable = friendly.severity === "recoverable";
      return Response.json(
        {
          error: friendly.message,
          code: friendly.code,
          severity: friendly.severity,
          content: friendly.content,
        },
        { status: recoverable ? 422 : 500 },
      );
    }
    return Response.json(
      { error: "Could not start checkout for this cart item." },
      { status: 500 },
    );
  }
}
