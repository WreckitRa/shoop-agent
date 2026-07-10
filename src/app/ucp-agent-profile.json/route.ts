import { NextResponse } from "next/server";
import { UCP_AGENT_PROFILE_CACHE_CONTROL } from "@/lib/env";

/**
 * UCP agent profile for Cart / Checkout / Order / Global Catalog MCP.
 * Inlined (not `public/`) to avoid Next.js "conflicting public file and page file"
 * which returns 500 and breaks merchant profile discovery (profile_malformed).
 *
 * @see https://ucp.dev/2026-04-08/specification/overview/
 * Cache-Control: public + max-age ≥ 60s; MUST NOT use private, no-store, or no-cache.
 */
export const dynamic = "force-static";
export const revalidate = 300;

const UCP_AGENT_PROFILE_BODY = JSON.stringify({
  ucp: {
    version: "2026-04-08",
    capabilities: {
      "dev.ucp.shopping.cart": [{ version: "2026-04-08" }],
      "dev.ucp.shopping.checkout": [{ version: "2026-04-08" }],
      "dev.ucp.shopping.order": [{ version: "2026-04-08" }],
      "dev.ucp.shopping.catalog.search": [{ version: "2026-04-08" }],
      "dev.ucp.shopping.catalog.lookup": [{ version: "2026-04-08" }],
      "dev.shopify.catalog.global": [
        {
          version: "2026-04-08",
          extends: [
            "dev.ucp.shopping.catalog.lookup",
            "dev.ucp.shopping.catalog.search",
          ],
        },
      ],
    },
  },
});

export async function GET() {
  return new NextResponse(UCP_AGENT_PROFILE_BODY, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": UCP_AGENT_PROFILE_CACHE_CONTROL,
    },
  });
}
