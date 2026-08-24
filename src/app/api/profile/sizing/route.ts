import { prisma } from "@/lib/ai-chat/db";
import { sizingProfilePatchSchema } from "@/lib/ai-chat/profile/validators";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  const parsed = sizingProfilePatchSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: "Invalid measurements." }, { status: 400 });
  }

  const row = await prisma.sizingProfile.upsert({
    where: { userId: auth.userId },
    create: { userId: auth.userId, ...parsed.data },
    update: parsed.data,
  });
  return Response.json({ sizing: row });
}
