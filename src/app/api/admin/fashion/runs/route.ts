import {
  adminNotConfiguredResponse,
  adminUnauthorizedResponse,
  isAdminConfigured,
  verifyAdminRequest,
} from "@/lib/admin/auth";
import { listFashionCatalogRuns } from "@/lib/admin/fashion-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAdminConfigured()) return adminNotConfiguredResponse();
  if (!verifyAdminRequest(req)) return adminUnauthorizedResponse();

  const url = new URL(req.url);
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit") ?? "40") || 40),
  );
  const conversationId = url.searchParams.get("conversationId")?.trim() || undefined;

  const runs = await listFashionCatalogRuns({ limit, conversationId });
  return Response.json({ runs });
}
