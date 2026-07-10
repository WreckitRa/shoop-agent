/**
 * Terminal trace for intent-branch (sidebar split) pipeline.
 *
 * Enabled in dev by default. Set INTENT_BRANCH_DEBUG=0 (server) or
 * NEXT_PUBLIC_INTENT_BRANCH_DEBUG=0 (client) to silence.
 * Set INTENT_BRANCH_DEBUG=1 to force on in production.
 */
type IntentBranchLogPayload = Record<string, unknown>;

function serverDebugFlag(): string | undefined {
  return process.env.INTENT_BRANCH_DEBUG;
}

function clientDebugFlag(): string | undefined {
  return process.env.NEXT_PUBLIC_INTENT_BRANCH_DEBUG;
}

export function isIntentBranchDebugEnabled(): boolean {
  const explicit = serverDebugFlag() ?? clientDebugFlag();
  if (explicit === "1") return true;
  if (explicit === "0") return false;
  return process.env.NODE_ENV !== "production";
}

export function logIntentBranch(
  phase: string,
  payload?: IntentBranchLogPayload,
): void {
  if (!isIntentBranchDebugEnabled()) return;
  const stamp = new Date().toISOString().slice(11, 23);
  console.info(`[intent_branch ${stamp}] ${phase}`);
  if (payload && Object.keys(payload).length > 0) {
    console.info(JSON.stringify(payload, null, 2));
  }
}
