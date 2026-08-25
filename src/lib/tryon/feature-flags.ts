import { prisma } from "@/lib/ai-chat/db";

const GLOBAL_FLAG_OFF_KEY = "tryon_global_spend_cap_off";

let globalCapTripped = false;

export function isGlobalTryonCapTripped(): boolean {
  if (globalCapTripped) return true;
  if (process.env.TRYON_GLOBAL_CAP_TRIPPED === "1") return true;
  return false;
}

export function resetGlobalTryonCapForTests(): void {
  globalCapTripped = false;
  delete process.env.TRYON_GLOBAL_CAP_TRIPPED;
}

export function tripGlobalTryonCap(): void {
  const firstTrip = !globalCapTripped && process.env.TRYON_GLOBAL_CAP_TRIPPED !== "1";
  globalCapTripped = true;
  process.env.TRYON_GLOBAL_CAP_TRIPPED = "1";
  console.error(
    `[tryon] Global daily spend cap exceeded — ${GLOBAL_FLAG_OFF_KEY}`,
  );
  if (firstTrip) {
    void import("@/lib/ops/alert-danny").then(({ alertDanny }) =>
      alertDanny({
        subject: "FASHN daily spend cap hit",
        body: `Try-on/FASHN estimated spend hit the daily ceiling (TRYON_GLOBAL_DAILY_SPEND_CAP). New generations are blocked until UTC midnight.`,
      }),
    );
  }
}

function isEnvFlagOff(value: string | undefined): boolean {
  return value === "0" || value?.toLowerCase() === "false";
}

/** Try-on is on for all users unless globally disabled or spend cap tripped. */
export async function isTryonEnabledForUser(userId: string): Promise<boolean> {
  if (isGlobalTryonCapTripped()) return false;
  if (isEnvFlagOff(process.env.TRYON_ENABLED)) return false;

  const allow = parseAllowlist(process.env.TRYON_USER_IDS);
  if (allow.size > 0) return allow.has(userId);

  return true;
}

export async function isTryonOutfitsEnabledForUser(
  userId: string,
): Promise<boolean> {
  if (!(await isTryonEnabledForUser(userId))) return false;
  if (isEnvFlagOff(process.env.TRYON_OUTFITS_ENABLED)) return false;
  return true;
}

function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export async function setTryonEnabledForUser(
  userId: string,
  enabled: boolean,
): Promise<void> {
  await prisma.userProfile.upsert({
    where: { userId },
    create: {
      userId,
      tryonEnabled: enabled,
      tryonOutfitsEnabled: enabled,
    },
    update: {
      tryonEnabled: enabled,
      tryonOutfitsEnabled: enabled,
    },
  });
}
