"use server";

import { AI_CHAT_DEFAULT_USER_ID } from "@/lib/ai-chat/constants";
import { resolveSwatchColors } from "@/lib/commerce/swatch-color-resolver";
import { getAuthContext } from "@/lib/auth/session";
import {
  guestUserIdFromSessionId,
  parseGuestSessionId,
} from "@/lib/auth/guest-session";

export async function resolveSwatchColorsAction(
  labels: string[],
  options?: {
    productId?: string | null;
    guestSessionId?: string | null;
  },
): Promise<Record<string, string>> {
  if (!labels.length) return {};

  const auth = await getAuthContext();
  let userId = auth.ok ? auth.userId : null;

  const guestSessionId = parseGuestSessionId(
    options?.guestSessionId?.trim() ?? null,
  );
  if (!userId && guestSessionId) {
    userId = guestUserIdFromSessionId(guestSessionId);
  }

  if (!userId) {
    userId = AI_CHAT_DEFAULT_USER_ID;
  }

  return resolveSwatchColors(labels, {
    userId,
    productId: options?.productId ?? null,
  });
}
