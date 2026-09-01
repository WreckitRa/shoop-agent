import {
  adminNotConfiguredResponse,
  adminUnauthorizedResponse,
  isAdminConfigured,
  verifyAdminRequest,
} from "@/lib/admin/auth";
import { listPilotAlerts } from "@/lib/fashion-memory/pilot-alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAdminConfigured()) return adminNotConfiguredResponse();
  if (!verifyAdminRequest(req)) return adminUnauthorizedResponse();

  const url = new URL(req.url);
  const limit = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get("limit") ?? "50") || 50),
  );
  const sinceHours = Number(url.searchParams.get("sinceHours") ?? "24") || 24;
  const alerts = await listPilotAlerts({ limit, sinceHours });
  const p0 = alerts.filter((a) => a.severity === "P0").length;
  return Response.json({ alerts, p0_count: p0, since_hours: sinceHours });
}
