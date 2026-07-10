import { ownedProduct } from "@/lib/ai-chat/owned-product-db";
import { ownedProductPatchSchema } from "@/lib/ai-chat/profile/validators";
import { getAuthContext } from "@/lib/auth/session";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const raw = await req.json();
    const parsed = ownedProductPatchSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid body." }, { status: 400 });
    }
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const existing = await ownedProduct.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return Response.json({ error: "Not found." }, { status: 404 });
    }

    const b = parsed.data;
    const acquiredAtRaw = b.acquiredAt ? new Date(b.acquiredAt) : undefined;
    const acquiredAt =
      acquiredAtRaw && !Number.isNaN(acquiredAtRaw.getTime())
        ? acquiredAtRaw
        : b.acquiredAt === null
        ? null
        : undefined;

    const row = await ownedProduct.update({
      where: { id },
      data: {
        category: b.category ?? undefined,
        subcategory: b.subcategory ?? undefined,
        brand: b.brand ?? undefined,
        productName: b.productName ?? undefined,
        model: b.model ?? undefined,
        attributes: b.attributes ? (b.attributes as object) : undefined,
        acquiredAt,
        acquiredNote: b.acquiredNote ?? undefined,
        notes: b.notes ?? undefined,
        isCurrent: b.isCurrent ?? undefined,
        confidence: 1,
        evidenceCount: { increment: 1 },
      },
    });
    return Response.json({ ownedProduct: row });
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
    const existing = await ownedProduct.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return Response.json({ error: "Not found." }, { status: 404 });
    }
    await ownedProduct.delete({ where: { id } });
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "Delete failed." }, { status: 500 });
  }
}
