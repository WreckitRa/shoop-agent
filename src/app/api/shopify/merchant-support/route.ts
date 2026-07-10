import { getAuthContext } from "@/lib/auth/session";
import { isSafeExternalHttpsOrigin } from "@/lib/http/safe-external-url";
import { getMerchantCommerceSupportFromCheckoutUrl } from "@/lib/shopify/merchant-support";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const checkoutUrl = url.searchParams.get("checkoutUrl");
  if (!checkoutUrl) {
    return Response.json({ error: "`checkoutUrl` is required." }, { status: 400 });
  }

  if (!isSafeExternalHttpsOrigin(checkoutUrl)) {
    return Response.json(
      { error: "Invalid checkout URL — must be a public HTTPS storefront URL." },
      { status: 400 },
    );
  }

  try {
    const support = await getMerchantCommerceSupportFromCheckoutUrl(checkoutUrl);
    return Response.json({ support });
  } catch {
    return Response.json(
      { error: "Could not inspect merchant checkout support." },
      { status: 500 },
    );
  }
}
