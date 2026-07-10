import { ownedProduct } from "@/lib/ai-chat/owned-product-db";
import { ownedProductPostSchema } from "@/lib/ai-chat/profile/validators";
import { getAuthContext } from "@/lib/auth/session";

export async function GET() {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const rows = await ownedProduct.findMany({
      where: { userId: userId },
      orderBy: [{ isCurrent: "desc" }, { updatedAt: "desc" }],
    });
    return Response.json({ ownedProducts: rows });
  } catch {
    return Response.json(
      { error: "Could not load owned products." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = ownedProductPostSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid body." }, { status: 400 });
    }
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const b = parsed.data;
    const subcategory = b.subcategory ?? "";
    const brand = b.brand ?? "";
    const acquiredAtRaw = b.acquiredAt ? new Date(b.acquiredAt) : null;
    const acquiredAt =
      acquiredAtRaw && !Number.isNaN(acquiredAtRaw.getTime())
        ? acquiredAtRaw
        : null;

    const row = await ownedProduct.upsert({
      where: {
        userId_category_subcategory_brand_productName: {
          userId,
          category: b.category,
          subcategory,
          brand,
          productName: b.productName,
        },
      },
      create: {
        userId,
        category: b.category,
        subcategory,
        brand,
        productName: b.productName,
        model: b.model ?? "",
        attributes: (b.attributes ?? {}) as object,
        acquiredAt,
        acquiredNote: b.acquiredNote ?? null,
        notes: b.notes ?? null,
        isCurrent: b.isCurrent ?? true,
        confidence: 1,
        evidenceCount: 1,
      },
      update: {
        model: b.model ?? undefined,
        attributes: b.attributes ? (b.attributes as object) : undefined,
        acquiredAt: acquiredAt ?? undefined,
        acquiredNote: b.acquiredNote ?? undefined,
        notes: b.notes ?? undefined,
        isCurrent: b.isCurrent ?? undefined,
        confidence: 1,
        evidenceCount: { increment: 1 },
      },
    });

    return Response.json({ ownedProduct: row });
  } catch {
    return Response.json(
      { error: "Could not save owned product." },
      { status: 500 },
    );
  }
}
