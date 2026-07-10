import { productCuration } from "@/lib/ai-chat/curation/db";
import { productCurationFromRow } from "@/lib/ai-chat/curation/serialize";
import { getAuthContext } from "@/lib/auth/session";

type Ctx = { params: Promise<{ productId: string }> };

/**
 * Latest persisted curator insight for `productId` belonging to the signed-in
 * user. Returns `{ curation: null }` when we have never curated this product
 * for them (e.g. it was viewed from a direct link without a prior search).
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { productId } = await ctx.params;
    const decodedId = decodeURIComponent(productId);
    if (!decodedId) {
      return Response.json({ error: "Missing productId." }, { status: 400 });
    }

    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;

    const row = await productCuration.findUnique({
      where: {
        userId_productExternalId: {
          userId: auth.userId,
          productExternalId: decodedId,
        },
      },
    });
    if (!row) return Response.json({ curation: null });

    return Response.json({
      curation: productCurationFromRow(row),
    });
  } catch {
    return Response.json(
      { error: "Could not load curation." },
      { status: 500 },
    );
  }
}
