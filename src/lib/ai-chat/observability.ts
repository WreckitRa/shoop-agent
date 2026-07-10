type LogLevel = "info" | "warn" | "error";

type LogPayload = Record<string, unknown>;

export function logAiChat(
  level: LogLevel,
  event: string,
  payload?: LogPayload,
) {
  if (process.env.NODE_ENV !== "development") return;

  const line = `[ai-chat:${level}] ${event}`;
  if (level === "error") {
    console.error(line, payload ?? "");
  } else if (level === "warn") {
    console.warn(line, payload ?? "");
  } else {
    console.info(line, payload ?? "");
  }
}
