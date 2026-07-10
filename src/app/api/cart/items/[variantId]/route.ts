import {
  CartNotFoundError,
  removeLineFromCart,
  updateLineQuantity,
} from "@/lib/cart/service";
import { cartUpdateItemSchema } from "@/lib/cart/validators";
import { getAuthContext } from "@/lib/auth/session";
import { getBuyerIpForShopifyMcp } from "@/lib/request-buyer-ip";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ variantId: string }> };

function statusForCartError(error: unknown): number {
  return error instanceof CartNotFoundError ? 404 : 500;
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const { variantId } = await ctx.params;
    const raw = await req.json();
    const parsed = cartUpdateItemSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid body." }, { status: 400 });
    }

    const shopDomain =
      new URL(req.url).searchParams.get("shop")?.trim() || undefined;

    let buyerIp: string | undefined;
    try {
      buyerIp = await getBuyerIpForShopifyMcp();
    } catch {
      // Buyer IP is best-effort for cart mutations.
    }

    const cart = await updateLineQuantity(
      userId,
      decodeURIComponent(variantId),
      parsed.data.quantity,
      { buyerIp, shopDomain },
    );
    return Response.json({ cart });
  } catch (error) {
    return Response.json(
      { error: error instanceof CartNotFoundError ? error.message : "Could not update cart item." },
      { status: statusForCartError(error) },
    );
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const { variantId } = await ctx.params;
    const shopDomain =
      new URL(_req.url).searchParams.get("shop")?.trim() || undefined;
    const cart = await removeLineFromCart(
      userId,
      decodeURIComponent(variantId),
      { shopDomain },
    );
    return Response.json({ cart });
  } catch (error) {
    return Response.json(
      { error: error instanceof CartNotFoundError ? error.message : "Could not remove cart item." },
      { status: statusForCartError(error) },
    );
  }
}
