import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import {
  findSeedBrand,
  searchSeedBrands,
  type CatalogBrand,
} from "@/lib/onboarding/brand-catalog";
import {
  listCommunityBrands,
  rememberCommunityBrand,
} from "@/lib/onboarding/onboarding-brand-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postSchema = z
  .object({
    name: z.string().min(1).max(60),
  })
  .strict();

function serialize(brand: CatalogBrand) {
  return {
    id: brand.id,
    name: brand.name,
    c1: brand.c1,
    c2: brand.c2,
    hasImage: brand.hasImage,
    source: brand.source,
  };
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;

    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    const community = await listCommunityBrands(q || undefined);
    if (!q) {
      return Response.json({ brands: community.map(serialize) });
    }

    const seedHits = searchSeedBrands(q, 12);
    const seen = new Set(seedHits.map((b) => b.id));
    const merged: CatalogBrand[] = [...seedHits];
    for (const b of community) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      merged.push(b);
    }
    const seedExact = findSeedBrand(q);
    return Response.json({
      brands: merged.slice(0, 16).map(serialize),
      exact: seedExact ? serialize(seedExact) : null,
    });
  } catch {
    return Response.json({ error: "Could not search brands." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;

    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid body.", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const brand = await rememberCommunityBrand(parsed.data.name);
    return Response.json({ brand: serialize(brand) });
  } catch {
    return Response.json({ error: "Could not save brand." }, { status: 500 });
  }
}
