import { prisma } from "@/lib/ai-chat/db";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";
import { FASHN_DELETION_NOTE } from "./constants";

export type PrivacyDeletionKind =
  | "account_close"
  | "erase_content"
  | "biometric_withdraw"
  | "inactivity"
  | "source_photo_retention"
  | "minor";

export async function recordPrivacyDeletion(params: {
  userId: string;
  kind: PrivacyDeletionKind;
  details?: Record<string, unknown>;
}): Promise<void> {
  await prisma.privacyDeletionEvent.create({
    data: {
      userId: params.userId,
      kind: params.kind,
      fashnNote: FASHN_DELETION_NOTE,
      details: (params.details ?? {}) as InputJsonValue,
      completedAt: new Date(),
    },
  });
}
