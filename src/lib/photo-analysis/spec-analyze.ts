import { decodeImage } from "./decode";
import { computeProfile } from "./profile";
import type { PhotoProfile } from "./types";

export async function analyzeSpecFromBytes(bytes: Buffer): Promise<PhotoProfile> {
  const img = await decodeImage(bytes);
  return computeProfile(img);
}
