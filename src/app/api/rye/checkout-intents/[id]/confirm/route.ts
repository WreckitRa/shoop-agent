import { getAuthContext } from "@/lib/auth/session";
import { getRyeClient, ryePollOptions } from "@/lib/rye/client";
import {
  ryeFailureUserMessage,
  ryeHttpErrorMessage,
  shouldFallbackToShopify,
} from "@/lib/rye/errors";
import { isRyeConfigured } from "@/lib/rye/env";
import { serializeRyeCheckoutIntent } from "@/lib/rye/serialize";
import { ryeCheckoutConfirmSchema } from "@/lib/rye/validators";
import { completeCheckoutPurchase } from "@/lib/fashion-memory/purchase-from-checkout";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  if (!isRyeConfigured()) {
    return Response.json({ error: "Rye checkout is not configured." }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return Response.json({ error: "Missing checkout intent id." }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ryeCheckoutConfirmSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Payment token is required." }, { status: 400 });
  }

  try {
    const intent = await getRyeClient().checkoutIntents.confirmAndPoll(
      id.trim(),
      {
        paymentMethod: {
          type: "stripe_token",
          stripeToken: parsed.data.stripeToken,
        },
      },
      ryePollOptions,
    );

    if (intent.state === "failed") {
      const code = intent.failureReason?.code;
      return Response.json({
        intent: serializeRyeCheckoutIntent(intent),
        error: ryeFailureUserMessage(code, intent.failureReason?.message),
        fallback: shouldFallbackToShopify(code) ? "shopify" : null,
        fixable: !shouldFallbackToShopify(code),
      });
    }

    const fashionPurchase =
      intent.state === "completed"
        ? await completeCheckoutPurchase({
            userId: auth.userId,
            productUrl: intent.productUrl,
            hint: {
              searchId: parsed.data.searchId,
              ref: parsed.data.ref,
              productId: parsed.data.productId,
              title: parsed.data.title,
              brand: parsed.data.brand,
              color: parsed.data.color,
            },
          })
        : null;

    return Response.json({
      intent: serializeRyeCheckoutIntent(intent),
      fashionPurchase,
    });
  } catch (error) {
    return Response.json({ error: ryeHttpErrorMessage(error) }, { status: 502 });
  }
}
