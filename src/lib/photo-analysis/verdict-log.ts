/** Dev-server stdout for the verdict card (looks, face colors, dress). */
import { logFitting } from "@/lib/onboarding/fitting-trace";

export function logVerdict(
  event: string,
  payload: Record<string, unknown> = {},
) {
  const bits = Object.entries(payload)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  console.info(`[verdict] ${event}${bits.length ? ` ${bits.join(" ")}` : ""}`);
  logFitting(`verdict.${event}`, payload);
}
