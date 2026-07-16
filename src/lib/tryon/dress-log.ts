import { logAiChat } from "@/lib/ai-chat/observability";

/** Dev-terminal dress try-on logs (`npm run dev`). Set TRYON_DEBUG=1 to force on. */
export function logTryonDress(
  level: "info" | "warn" | "error",
  event: string,
  payload?: Record<string, unknown>,
): void {
  const enabled =
    process.env.NODE_ENV === "development" || process.env.TRYON_DEBUG === "1";
  if (!enabled) return;

  const line = `[tryon-dress:${level}] ${event}`;
  if (level === "error") {
    console.error(line, payload ?? "");
  } else if (level === "warn") {
    console.warn(line, payload ?? "");
  } else {
    console.info(line, payload ?? "");
  }
}
