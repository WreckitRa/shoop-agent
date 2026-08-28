import { z } from "zod";
import type { ProductCard } from "@/lib/ai-chat/types";
import { trackProductEvent } from "@/lib/analytics/track";
import {
  writeFashionPickAcceptance,
  writeFashionPickRejection,
} from "@/lib/fashion-memory/direct-writes";
import { getAuthContext } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const productSchema: z.ZodType<ProductCard> = z
  .object({
    id: z.string().min(1),
    title: z.string(),
  })
  .passthrough();

const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("acceptance"),
    product: productSchema,
    conversationId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("rejection"),
    product: productSchema,
    reason: z.string().optional(),
  }),
]);

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request." }, { status: 400 });
    }

    if (parsed.data.kind === "acceptance") {
      await writeFashionPickAcceptance({
        userId: auth.userId,
        product: parsed.data.product,
        conversationId: parsed.data.conversationId,
      });
      trackProductEvent({
        name: "item_reacted",
        userId: auth.userId,
        props: {
          item_id: parsed.data.product.id,
          reaction: "accept",
        },
      });
    } else {
      await writeFashionPickRejection({
        userId: auth.userId,
        product: parsed.data.product,
        reason: parsed.data.reason,
      });
      trackProductEvent({
        name: "item_reacted",
        userId: auth.userId,
        props: {
          item_id: parsed.data.product.id,
          reaction: "reject",
          reason: parsed.data.reason ?? null,
        },
      });
    }

    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Pick signal failed." }, { status: 500 });
  }
}
