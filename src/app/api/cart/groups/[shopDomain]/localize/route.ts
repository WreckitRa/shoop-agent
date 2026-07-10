import { getBuyerIpForShopifyMcp } from "@/lib/request-buyer-ip";
import { CartNotFoundError, localizeCartGroup } from "@/lib/cart/service";
import { cartLocalizeSchema } from "@/lib/cart/validators";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ shopDomain: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;

    const { shopDomain: rawShopDomain } = await ctx.params;
    const shopDomain = decodeURIComponent(rawShopDomain);
    const parsed = cartLocalizeSchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid body.", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const buyerIp = await getBuyerIpForShopifyMcp();
    const cart = await localizeCartGroup(
      auth.userId,
      shopDomain,
      parsed.data.shippingAddress,
      { buyerIp },
    );
    return Response.json({ cart });
  } catch (error) {
    if (error instanceof CartNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not update cart pricing for this address.",
      },
      { status: 500 },
    );
  }
}
