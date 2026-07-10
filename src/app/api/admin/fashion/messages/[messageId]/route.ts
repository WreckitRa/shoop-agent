import {
  adminNotConfiguredResponse,
  adminUnauthorizedResponse,
  isAdminConfigured,
  verifyAdminRequest,
} from "@/lib/admin/auth";
import { getFashionCatalogRunByMessageId } from "@/lib/admin/fashion-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ messageId: string }> };

export async function GET(req: Request, ctx: RouteCtx) {
  if (!isAdminConfigured()) return adminNotConfiguredResponse();
  if (!verifyAdminRequest(req)) return adminUnauthorizedResponse();

  const { messageId } = await ctx.params;
  const detail = await getFashionCatalogRunByMessageId(messageId.trim());
  if (!detail) {
    return Response.json({ error: "Fashion catalog run not found." }, { status: 404 });
  }
  return Response.json(detail);
}
