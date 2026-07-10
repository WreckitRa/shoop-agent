import { APIUserAbortError } from "@anthropic-ai/sdk/error";

/** Chat stream stop / client disconnect / explicit AbortSignal. */
export function isAbortLike(err: unknown): boolean {
  if (err instanceof APIUserAbortError) return true;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  return err instanceof Error && err.name === "AbortError";
}

export function memoryPipelineAborted(signal?: AbortSignal | null): boolean {
  return signal?.aborted === true;
}
