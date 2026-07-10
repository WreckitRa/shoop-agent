import { getAuthContext } from "@/lib/auth/session";
import { getRyeClient } from "@/lib/rye/client";
import {
  ryeFailureUserMessage,
  ryeHttpErrorMessage,
  shouldFallbackToShopify,
} from "@/lib/rye/errors";
import { isRyeConfigured } from "@/lib/rye/env";
import { serializeRyeCheckoutIntent } from "@/lib/rye/serialize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  if (!isRyeConfigured()) {
    return Response.json({ error: "Rye checkout is not configured." }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return Response.json({ error: "Missing checkout intent id." }, { status: 400 });
  }

  try {
    const intent = await getRyeClient().checkoutIntents.retrieve(id.trim());
    const snapshot = serializeRyeCheckoutIntent(intent);
    const failureCode =
      intent.state === "failed" ? intent.failureReason?.code : undefined;

    return Response.json({
      intent: snapshot,
      error:
        intent.state === "failed"
          ? ryeFailureUserMessage(
              intent.failureReason?.code,
              intent.failureReason?.message,
            )
          : null,
      fallback:
        intent.state === "failed" && shouldFallbackToShopify(failureCode)
          ? "shopify"
          : null,
    });
  } catch (error) {
    return Response.json({ error: ryeHttpErrorMessage(error) }, { status: 502 });
  }
}
