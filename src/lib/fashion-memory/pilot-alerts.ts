import { fashionMemoryDb } from "./db";
import { logAiChat } from "@/lib/ai-chat/observability";

export type PilotAlertSeverity = "P0" | "P1";

export type PilotAlertRow = {
  id: string;
  code: string;
  severity: PilotAlertSeverity;
  payload: Record<string, unknown>;
  created_at: string;
};

/**
 * Persist a pilot alert. Never throws — a failed insert still console.errors
 * so day-one P0s are not silent.
 */
export async function writePilotAlert(params: {
  code: string;
  severity?: PilotAlertSeverity;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const severity = params.severity ?? "P0";
  const payload = params.payload ?? {};
  console.error(`[PILOT][${severity}] ${params.code}`, payload);
  logAiChat("error", params.code, payload);
  try {
    const { error } = await fashionMemoryDb().from("pilot_alerts").insert({
      code: params.code,
      severity,
      payload,
    });
    if (error) {
      console.error("[PILOT] pilot_alerts insert failed", {
        code: params.code,
        error: String(error.message ?? error).slice(0, 200),
      });
    }
  } catch (err) {
    console.error("[PILOT] pilot_alerts insert failed", {
      code: params.code,
      error: String(err).slice(0, 200),
    });
  }
}

export async function listPilotAlerts(params?: {
  limit?: number;
  sinceHours?: number;
}): Promise<PilotAlertRow[]> {
  const limit = Math.min(200, Math.max(1, params?.limit ?? 50));
  let q = fashionMemoryDb()
    .from("pilot_alerts")
    .select("id, code, severity, payload, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (params?.sinceHours && params.sinceHours > 0) {
    const since = new Date(
      Date.now() - params.sinceHours * 60 * 60 * 1000,
    ).toISOString();
    q = q.gte("created_at", since);
  }
  const { data, error } = await q;
  if (error || !data) return [];
  return data as PilotAlertRow[];
}
