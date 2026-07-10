import { prisma } from "@/lib/ai-chat/db";
import { intentPatchSchema } from "@/lib/ai-chat/profile/validators";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";
import { getAuthContext } from "@/lib/auth/session";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const raw = await req.json();
    const parsed = intentPatchSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid body." }, { status: 400 });
    }
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const existing = await prisma.shoppingIntent.findFirst({ where: { id, userId } });
    if (!existing) return Response.json({ error: "Not found." }, { status: 404 });

    const b = parsed.data;
    const data: Record<string, unknown> = {};
    if (b.status !== undefined) data.status = b.status;
    if (b.intentName !== undefined) data.intentName = b.intentName;
    if (b.description !== undefined) data.description = b.description;
    if (b.category !== undefined) data.category = b.category;
    if (b.subcategory !== undefined) data.subcategory = b.subcategory;
    if (b.recipientId !== undefined) data.recipientId = b.recipientId;
    if (b.constraints !== undefined) data.constraints = b.constraints as InputJsonValue;
    if (b.priority !== undefined) data.priority = b.priority;
    if (b.neededBy !== undefined) data.neededBy = b.neededBy ? new Date(b.neededBy) : null;

    const row = await prisma.shoppingIntent.update({
      where: { id },
      data,
    });
    return Response.json({ intent: row });
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
    const existing = await prisma.shoppingIntent.findFirst({ where: { id, userId } });
    if (!existing) return Response.json({ error: "Not found." }, { status: 404 });
    await prisma.shoppingIntent.delete({ where: { id } });
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "Delete failed." }, { status: 500 });
  }
}
