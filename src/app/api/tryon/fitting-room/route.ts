import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { startFittingRoomRender } from "@/lib/tryon/run-fitting-room";
import { TryonCapError } from "@/lib/tryon/generations";
import { MAX_FITTING_ROOM_ITEMS } from "@/lib/tryon/fitting-room-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const provenanceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("search"),
    searchId: z.string().min(1),
    ref: z.string().min(1),
  }),
  z.object({
    kind: z.literal("product"),
    productId: z.string().min(1),
    variantId: z.string().optional(),
    preferredOptions: z
      .array(
        z.object({
          name: z.string(),
          label: z.string(),
        }),
      )
      .optional(),
  }),
  z.object({
    kind: z.literal("image"),
    imageUrl: z.string().min(1).max(2000),
    title: z.string().max(200).optional(),
    garment: z.string().max(200).optional(),
    styleId: z.string().max(120).optional(),
  }),
]);

const bodySchema = z.object({
  items: z.array(z.object({ provenance: provenanceSchema })).min(1),
});

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (parsed.data.items.length > MAX_FITTING_ROOM_ITEMS) {
    return Response.json(
      { error: "Fitting room supports up to six garments at a time." },
      { status: 400 },
    );
  }

  try {
    const result = await startFittingRoomRender({
      userId: auth.userId,
      descriptors: parsed.data.items,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof TryonCapError) {
      return Response.json({ error: error.message }, { status: 429 });
    }
    const message =
      error instanceof Error ? error.message : "Fitting room render failed.";
    const status =
      message.includes("not found") ||
      message.includes("not enabled") ||
      message.includes("Avatar required")
        ? 400
        : 500;
    return Response.json({ error: message }, { status });
  }
}
