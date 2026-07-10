import { addLineToCart } from "@/lib/cart/service";
import { cartAddItemSchema } from "@/lib/cart/validators";
import { MERCHANT_MCP_UNSUPPORTED_MARKER } from "@/lib/shopify/mcp-parse";
import { getAuthContext } from "@/lib/auth/session";
import { getBuyerIpForShopifyMcp } from "@/lib/request-buyer-ip";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const raw = await req.json();
    const parsed = cartAddItemSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid body." }, { status: 400 });
    }

    let buyerIp: string | undefined;
    try {
      buyerIp = await getBuyerIpForShopifyMcp();
    } catch {
      // Buyer IP is best-effort for cart; do not block the add-to-cart operation.
    }

    const cart = await addLineToCart(userId, { ...parsed.data, buyerIp });
    return Response.json({ cart });
  } catch (error) {
    if (error instanceof Error && error.message.includes(MERCHANT_MCP_UNSUPPORTED_MARKER)) {
      return Response.json(
        { error: MERCHANT_MCP_UNSUPPORTED_MARKER },
        { status: 502 },
      );
    }
    return Response.json({ error: "Could not add item to cart." }, { status: 500 });
  }
}
