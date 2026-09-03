import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { requireAvatarOwner } from "@/lib/tryon/avatar/request-auth";
import {
  approveAvatar,
  generateAvatarPreview,
  getStoredAvatar,
} from "@/lib/tryon/avatar/service";
import { isTransientTryonStorageError } from "@/lib/tryon/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  person_id: z.string().uuid(),
  action: z.enum(["generate", "approve"]),
  selected_provider_key: z.enum(["fashn"]).optional(),
  attributes: z
    .object({
      height_band: z.string().optional(),
      build: z.string().optional(),
      muscularity: z.string().optional(),
      body_shape: z.string().optional(),
      bust_fullness: z.string().optional(),
    })
    .optional(),
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
  try {
    if (parsed.data.action === "generate") {
      const draft = await generateAvatarPreview({
        userId: owner.userId,
        personId: parsed.data.person_id,
        attributes: parsed.data.attributes as import("@/lib/tryon/types").AvatarAttributes | undefined,
      });
      return Response.json({ ok: true, draft });
    }
    const avatar = await approveAvatar({
      userId: owner.userId,
      personId: parsed.data.person_id,
      selectedProviderKey: parsed.data.selected_provider_key,
    });
    const fresh = await getStoredAvatar(owner.userId, parsed.data.person_id);
    return Response.json({
      ok: true,
      avatar: fresh ?? avatar,
    });
  } catch (error) {
    const transient = isTransientTryonStorageError(error);
    const message =
      error instanceof Error ? error.message : "Avatar action failed.";
    return Response.json(
      {
        error: transient
          ? "Twin generation is busy — try again."
          : message,
      },
      { status: transient ? 503 : 500 },
    );
  }
}
