/**
 * Dev/ops logging for clarification + gift-direction visual previews.
 * Enabled when OPTION_PREVIEW_DEBUG=1 or NODE_ENV !== "production".
 */
type PreviewLogPayload = Record<string, unknown>;

function previewLoggingEnabled(): boolean {
  return process.env.OPTION_PREVIEW_DEBUG === "1";
}

export function logOptionPreview(
  stage: string,
  payload?: PreviewLogPayload,
): void {
  if (!previewLoggingEnabled()) return;
  const line = payload ? `${stage} ${JSON.stringify(payload)}` : stage;
  console.info(`[option_preview] ${line}`);
}
