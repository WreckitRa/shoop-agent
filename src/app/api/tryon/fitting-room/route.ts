import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { startFittingRoomRender } from "@/lib/tryon/run-fitting-room";
import { MAX_FITTING_ROOM_ITEMS } from "@/lib/tryon/fitting-room-types";
import { tryonErrorResponse } from "@/lib/tryon/resolve-person";
import { requireAvatarOwner } from "@/lib/tryon/avatar/request-auth";
import { logVerdict } from "@/lib/photo-analysis/verdict-log";

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
  const owner = await requireAvatarOwner(req, auth);
  if (!owner.ok) return owner.response;

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

  const fromVerdict = req.headers.get("x-shoop-verdict") === "1";
  const kinds = parsed.data.items.map((item) => item.provenance.kind);
  const refs = parsed.data.items.map((item) => {
    const p = item.provenance;
    if (p.kind === "product") return p.productId;
    if (p.kind === "image") return p.styleId || p.title || p.garment || "image";
    return p.ref;
  });
  if (fromVerdict) {
    logVerdict("dress-start", { n: parsed.data.items.length, kinds, refs });
  }

  try {
    const result = await startFittingRoomRender({
      userId: owner.userId,
      searchUserId: auth.userId,
      descriptors: parsed.data.items,
    });
    if (fromVerdict) {
      logVerdict("dress-queued", {
        jobId: result.jobId,
        n: parsed.data.items.length,
      });
    }
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (fromVerdict) {
      logVerdict("dress-error", {
        error: error instanceof Error ? error.message : "unknown",
        kinds,
      });
    }
    return tryonErrorResponse(error);
  }
}
