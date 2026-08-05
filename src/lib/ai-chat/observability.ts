type LogLevel = "info" | "warn" | "error";

type LogPayload = Record<string, unknown>;

/** Kept as a no-op so call sites stay stable without console noise. */
export function logAiChat(
  _level: LogLevel,
  _event: string,
  _payload?: LogPayload,
) {
  // intentionally empty
}
