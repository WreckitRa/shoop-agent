import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { isValidGuestSessionToken } from "@/lib/auth/guest-session";
import { migrateGuestDataToUser } from "@/lib/auth/migrate-guest-data";
import type { GuestLocalData } from "@/lib/client/guest-storage";

export const dynamic = "force-dynamic";

const migrateGuestBodySchema = z
  .object({
    guestId: z.string().refine(isValidGuestSessionToken, "Invalid guest session id."),
    data: z
      .object({
        version: z.literal(1),
        guestId: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
        conversations: z.array(z.record(z.string(), z.unknown())),
        messagesByConversationId: z.record(
          z.string(),
          z.array(z.record(z.string(), z.unknown())),
        ),
        memory: z.record(z.string(), z.unknown()).optional(),
        fashionMemory: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    if (auth.isGuest) {
      return Response.json(
        { error: "Sign in with a full account to migrate guest data." },
        { status: 403 },
      );
    }

    const raw = await req.json();
    const parsed = migrateGuestBodySchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid request." }, { status: 400 });
    }

    const { guestId, data } = parsed.data;
    if (data && data.guestId !== guestId) {
      return Response.json({ error: "Guest id mismatch." }, { status: 400 });
    }

    const result = await migrateGuestDataToUser({
      guestId,
      realUserId: auth.userId,
      localData: data as GuestLocalData | undefined,
    });

    return Response.json({ ok: true, migratedFrom: result.guestUserId });
  } catch {
    return Response.json({ error: "Migration failed." }, { status: 500 });
  }
}
