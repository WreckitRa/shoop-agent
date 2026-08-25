import { kvIncrBy } from "@/lib/cache/kv-store";
import { requestClientIp } from "@/lib/rate-limit";
import { PHOTO_ERROR } from "./errors";

const DAY_TTL_SECONDS = 60 * 60 * 36;

export class PhotoUploadCapError extends Error {
  readonly status = 429;
  constructor(message = PHOTO_ERROR.daily_limit) {
    super(message);
    this.name = "PhotoUploadCapError";
  }
}

export function photoUploadUserDailyCap(): number {
  return Number(process.env.PHOTO_UPLOAD_USER_DAILY_CAP ?? "8");
}

export function photoUploadIpDailyCap(): number {
  return Number(process.env.PHOTO_UPLOAD_IP_DAILY_CAP ?? "20");
}

function utcDayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function capNs(): string {
  return process.env.PHOTO_UPLOAD_CAP_NS?.trim() || "default";
}

/** Per-user and per-IP UTC-day upload caps. Burst IP cap lives in middleware. */
export async function assertPhotoUploadCaps(params: {
  userId: string;
  req: { headers: { get(name: string): string | null } };
}): Promise<void> {
  const userCap = photoUploadUserDailyCap();
  const ipCap = photoUploadIpDailyCap();
  const ns = capNs();
  const day = utcDayStamp();
  const ttl = DAY_TTL_SECONDS;

  if (userCap > 0) {
    const n = await kvIncrBy(
      `photo-user-day:${ns}:${day}:${params.userId}`,
      1,
      ttl,
    );
    if (n > userCap) throw new PhotoUploadCapError();
  }

  if (ipCap > 0) {
    const ip = requestClientIp(params.req);
    const n = await kvIncrBy(`photo-ip-day:${ns}:${day}:${ip}`, 1, ttl);
    if (n > ipCap) throw new PhotoUploadCapError();
  }
}
