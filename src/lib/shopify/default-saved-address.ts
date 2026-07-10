import { prisma } from "@/lib/ai-chat/db";
import type { SavedAddressLocaleHint } from "@/lib/shopify/catalog-localization";

/** Default saved shipping address used for catalog pricing when profile locale is unset. */
export async function loadDefaultSavedAddressLocale(
  userId: string,
): Promise<SavedAddressLocaleHint | null> {
  const row = await prisma.savedAddress.findFirst({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    select: {
      addressCountry: true,
      addressRegion: true,
      postalCode: true,
    },
  });
  if (!row?.addressCountry?.trim()) return null;
  return row;
}
