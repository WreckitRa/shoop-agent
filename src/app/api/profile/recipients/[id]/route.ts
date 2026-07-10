import { prisma } from "@/lib/ai-chat/db";
import { recipientPatchSchema } from "@/lib/ai-chat/profile/validators";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";
import { getAuthContext } from "@/lib/auth/session";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const raw = await req.json();
    const parsed = recipientPatchSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid body." }, { status: 400 });
    }
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const existing = await prisma.recipient.findFirst({ where: { id, userId } });
    if (!existing) return Response.json({ error: "Not found." }, { status: 404 });

    const b = parsed.data;
    const data: Record<string, unknown> = {};
    if (b.name !== undefined) data.name = b.name;
    if (b.relationship !== undefined) data.relationship = b.relationship;
    if (b.ageRange !== undefined) data.ageRange = b.ageRange;
    if (b.birthDate !== undefined) data.birthDate = b.birthDate ? new Date(b.birthDate) : null;
    if (b.knownPreferences !== undefined) data.knownPreferences = b.knownPreferences;
    if (b.dislikes !== undefined) data.dislikes = b.dislikes;
    if (b.favoriteBrands !== undefined) data.favoriteBrands = b.favoriteBrands;
    if (b.dislikedBrands !== undefined) data.dislikedBrands = b.dislikedBrands;
    if (b.sizes !== undefined) data.sizes = b.sizes as InputJsonValue;
    if (b.importantDates !== undefined) data.importantDates = b.importantDates as InputJsonValue;
    if (b.giftHistory !== undefined) data.giftHistory = b.giftHistory as InputJsonValue;
    if (b.privacyLevel !== undefined) data.privacyLevel = b.privacyLevel;

    const row = await prisma.recipient.update({
      where: { id },
      data: { ...data, confidence: 1, evidenceCount: { increment: 1 } },
    });
    return Response.json({ recipient: row });
  } catch {
    return Response.json({ error: "Update failed." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const existing = await prisma.recipient.findFirst({ where: { id, userId } });
    if (!existing) return Response.json({ error: "Not found." }, { status: 404 });
    await prisma.recipient.delete({ where: { id } });
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "Delete failed." }, { status: 500 });
  }
}
