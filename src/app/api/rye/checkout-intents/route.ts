import { getAuthContext } from "@/lib/auth/session";
import { trackProductEvent } from "@/lib/analytics/track";
import { checkoutFormToRyeBuyer, isUsRyeCheckoutCountry } from "@/lib/rye/buyer";
import { getRyeClient, ryePollOptions } from "@/lib/rye/client";
import {
  ryeFailureUserMessage,
  ryeHttpErrorMessage,
  ryeHttpShouldFallback,
  shouldFallbackToShopify,
} from "@/lib/rye/errors";
import { isRyeConfigured } from "@/lib/rye/env";
import { serializeRyeCheckoutIntent } from "@/lib/rye/serialize";
import { ryeCheckoutCreateSchema } from "@/lib/rye/validators";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  if (!isRyeConfigured()) {
    return Response.json(
      { error: "Rye checkout is not configured.", fallback: "shopify" },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ryeCheckoutCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid checkout request.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const body = parsed.data;

  trackProductEvent({
    name: "checkout_start",
    userId: auth.userId,
    props: {
      source: "rye",
      product_url: body.productUrl,
      quantity: body.quantity,
    },
  });

  if (!isUsRyeCheckoutCountry(body.shippingAddress.addressCountry)) {
    return Response.json(
      { error: "Rye checkout requires a US shipping address.", fallback: "shopify" },
      { status: 400 },
    );
  }

  try {
    const buyer = checkoutFormToRyeBuyer({
      buyerEmail: body.buyerEmail,
      shippingAddress: body.shippingAddress,
    });

    const client = getRyeClient();
    const intent = await client.checkoutIntents.createAndPoll(
      {
        buyer,
        productUrl: body.productUrl,
        quantity: body.quantity,
      },
      ryePollOptions,
    );

    if (intent.state === "failed") {
      const code = intent.failureReason?.code;
      const fallback = shouldFallbackToShopify(code);
      return Response.json({
        intent: serializeRyeCheckoutIntent(intent),
        fallback: fallback ? "shopify" : null,
        error: ryeFailureUserMessage(code, intent.failureReason?.message),
        fixable: !fallback,
      });
    }

    return Response.json({ intent: serializeRyeCheckoutIntent(intent) });
  } catch (error) {
    const message = ryeHttpErrorMessage(error);
    const fallback =
      ryeHttpShouldFallback(error) ||
      message.toLowerCase().includes("product url");
    return Response.json(
      {
        error: message,
        fallback: fallback ? "shopify" : null,
      },
      { status: fallback ? 422 : 502 },
    );
  }
}
