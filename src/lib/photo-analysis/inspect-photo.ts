import { PHOTO_MAX_BYTES } from "./decode";
import { PHOTO_ERROR } from "./errors";

export const PHOTO_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type PhotoAllowedType = (typeof PHOTO_ALLOWED_TYPES)[number];

export type PhotoInspectOk = {
  ok: true;
  contentType: PhotoAllowedType;
};

export type PhotoInspectFail = {
  ok: false;
  status: 400 | 413 | 415;
  error: string;
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sniffPhotoType(bytes: Buffer): PhotoAllowedType | null {
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(JPEG)) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG)) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Size + magic-byte check. Declared MIME is ignored. */
export function inspectPhotoBytes(bytes: Buffer): PhotoInspectOk | PhotoInspectFail {
  if (!bytes.length) {
    return { ok: false, status: 400, error: PHOTO_ERROR.empty };
  }
  if (bytes.length > PHOTO_MAX_BYTES) {
    return { ok: false, status: 413, error: PHOTO_ERROR.too_large };
  }
  const contentType = sniffPhotoType(bytes);
  if (!contentType) {
    return { ok: false, status: 415, error: PHOTO_ERROR.unsupported_type };
  }
  return { ok: true, contentType };
}
