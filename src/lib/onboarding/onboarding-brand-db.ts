import { prisma } from "@/lib/ai-chat/db";
import {
  brandSlug,
  communityBrand,
  findSeedBrand,
  type CatalogBrand,
} from "@/lib/onboarding/brand-catalog";

type BrandRow = { slug: string; name: string };

type BrandDelegate = {
  findMany: (args: {
    where?: { name?: { contains: string; mode: "insensitive" } };
    orderBy?: { createdAt: "desc" };
    take?: number;
  }) => Promise<BrandRow[]>;
  findUnique: (args: { where: { slug: string } }) => Promise<BrandRow | null>;
  create: (args: { data: { slug: string; name: string } }) => Promise<BrandRow>;
};

function delegate(): BrandDelegate | null {
  const d = (prisma as unknown as { onboardingBrand?: BrandDelegate })
    .onboardingBrand;
  if (!d?.findMany || !d?.findUnique || !d?.create) return null;
  return d;
}

function asCatalog(row: BrandRow): CatalogBrand {
  return communityBrand(row.name);
}

export async function listCommunityBrands(query?: string): Promise<CatalogBrand[]> {
  const d = delegate();
  if (!d) return [];
  const q = query?.trim();
  try {
    const rows = await d.findMany({
      ...(q
        ? { where: { name: { contains: q, mode: "insensitive" } } }
        : {}),
      orderBy: { createdAt: "desc" },
      take: q ? 16 : 40,
    });
    return rows.map(asCatalog);
  } catch {
    return [];
  }
}

export async function rememberCommunityBrand(
  name: string,
): Promise<CatalogBrand> {
  const trimmed = name.trim().slice(0, 60);
  const seed = findSeedBrand(trimmed);
  if (seed) return seed;

  const slug = brandSlug(trimmed);
  if (!slug) return communityBrand(trimmed);

  const d = delegate();
  if (!d) return communityBrand(trimmed);

  try {
    const existing = await d.findUnique({ where: { slug } });
    if (existing) return asCatalog(existing);
    const created = await d.create({ data: { slug, name: trimmed } });
    return asCatalog(created);
  } catch {
    return communityBrand(trimmed);
  }
}
