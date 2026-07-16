import { lookupWhyProduct } from "@/lib/qa/why-product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const product = url.searchParams.get("product")?.trim();
  const traceId = url.searchParams.get("trace")?.trim() || null;

  if (!product) {
    return Response.json({ error: "product query param is required." }, { status: 400 });
  }

  const result = await lookupWhyProduct({ productRef: product, traceId });
  if (!result.productId) {
    return Response.json(
      { error: "Could not resolve product URL or id.", product },
      { status: 400 },
    );
  }

  return Response.json(result);
}
