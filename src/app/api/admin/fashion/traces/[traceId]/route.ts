import {
  adminNotConfiguredResponse,
  adminUnauthorizedResponse,
  isAdminConfigured,
  verifyAdminRequest,
} from "@/lib/admin/auth";
import { getFashionCatalogRunByTraceId } from "@/lib/admin/fashion-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ traceId: string }> };

export async function GET(req: Request, ctx: RouteCtx) {
  if (!isAdminConfigured()) return adminNotConfiguredResponse();
  if (!verifyAdminRequest(req)) return adminUnauthorizedResponse();

  const { traceId } = await ctx.params;
  const detail = await getFashionCatalogRunByTraceId(traceId.trim());
  if (!detail) {
    return Response.json({ error: "Trace not found." }, { status: 404 });
  }
  return Response.json(detail);
}
