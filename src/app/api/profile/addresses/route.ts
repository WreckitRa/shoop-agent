import { prisma } from "@/lib/ai-chat/db";
import { normalizeShopifyCountryInput, shopifyCountryLabel } from "@/lib/cart/countries";
import { normalizeRegionInput } from "@/lib/cart/regions";
import { savedAddressPostSchema } from "@/lib/cart/validators";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const addresses = await prisma.savedAddress.findMany({
      where: { userId: userId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
    return Response.json({ addresses });
  } catch {
    return Response.json(
      { error: "Could not load saved addresses." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = savedAddressPostSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid body.", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const body = parsed.data;
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const addressCountry = normalizeShopifyCountryInput(body.addressCountry);
    const addressRegion = normalizeRegionInput(addressCountry, body.addressRegion);

    if (body.isDefault) {
      await prisma.savedAddress.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const address = await prisma.savedAddress.upsert({
      where: {
        userId_addressCountry_postalCode_streetAddress: {
          userId,
          addressCountry,
          postalCode: body.postalCode.trim(),
          streetAddress: body.streetAddress.trim(),
        },
      },
      create: {
        userId,
        label: body.label?.trim() || null,
        buyerEmail: body.buyerEmail?.trim() || null,
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        phoneNumber: body.phoneNumber.trim(),
        streetAddress: body.streetAddress.trim(),
        addressLocality: body.addressLocality.trim(),
        addressRegion,
        postalCode: body.postalCode.trim(),
        addressCountry,
        isDefault: body.isDefault ?? false,
      },
      update: {
        label: body.label?.trim() || null,
        buyerEmail: body.buyerEmail?.trim() || null,
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        phoneNumber: body.phoneNumber.trim(),
        addressLocality: body.addressLocality.trim(),
        addressRegion,
        isDefault: body.isDefault ?? undefined,
      },
    });

    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { shippingCountry: true, country: true },
    });
    if (!profile?.shippingCountry?.trim() && !profile?.country?.trim()) {
      const shippingCountry = shopifyCountryLabel(addressCountry) ?? addressCountry;
      await prisma.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          shippingCountry,
          confidence: 1,
          evidenceCount: 1,
        },
        update: { shippingCountry },
      });
    }

    return Response.json({ address });
  } catch {
    return Response.json(
      { error: "Could not save address." },
      { status: 500 },
    );
  }
}
