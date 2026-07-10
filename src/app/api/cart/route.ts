import { logAiChat } from "@/lib/ai-chat/observability";
import { clearActiveCart, getActiveCart } from "@/lib/cart/service";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

function cartErrorResponse(
  fallback: string,
  error: unknown,
): Response {
  logAiChat("error", "cart_route_failed", { error });
  const detail =
    process.env.NODE_ENV === "development" && error instanceof Error
      ? error.message
      : fallback;
  return Response.json({ error: detail }, { status: 500 });
}

export async function GET() {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const cart = await getActiveCart(userId);
    return Response.json({ cart });
  } catch (error) {
    return cartErrorResponse("Could not load cart.", error);
  }
}

export async function DELETE() {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const cart = await clearActiveCart(userId);
    return Response.json({ cart });
  } catch (error) {
    return cartErrorResponse("Could not clear cart.", error);
  }
}
