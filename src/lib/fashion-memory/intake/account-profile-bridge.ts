import { prisma } from "@/lib/ai-chat/db";
import { isSupabaseAuthUserId } from "../auth";
import type { PersonRow } from "../types";
import type { SizeGarmentBucket } from "./garment-size-fields";
import type { GenderPresentation } from "./identity-gate";

export type IntakeProfileHints = {
  genderPresentation: GenderPresentation | null;
  sizeBuckets: ReadonlySet<SizeGarmentBucket>;
  /** Preferred name from account settings — for roster display. */
  preferredName: string | null;
  /** Compact size lines for router PROFILES (account sizing, not fashion_facts). */
  sizeLines: string[];
};

/**
 * Account onboarding gender/sizing applies only when shopping for self.
 * Gift recipients must not inherit the shopper's department or sizes.
 */
export function intakeHintsForRecipient(
  person: Pick<PersonRow, "relation"> | null | undefined,
  hints: IntakeProfileHints | null,
): IntakeProfileHints | null {
  if (!hints) return null;
  if (!person || person.relation !== "self") return null;
  return hints;
}

export function genderFromUserProfile(
  raw: string | null | undefined,
): GenderPresentation | null {
  const t = raw?.trim().toLowerCase() ?? "";
  if (!t) return null;
  if (/\b(men|mens|men'?s|masculine|male)\b/.test(t)) return "mens";
  if (/\b(women|womens|women'?s|feminine|female)\b/.test(t)) return "womens";
  if (/\b(mix|mixed|non.?binary|fluid|both)\b/.test(t)) return "mixed";
  return null;
}

function sizeBucketsFromSizingProfile(
  sizing: {
    topUsualSize?: string | null;
    bottomUsualSize?: string | null;
    bottomWaist?: string | null;
    shoeEU?: number | null;
    shoeUS?: number | null;
    shoeUK?: number | null;
  } | null,
): Set<SizeGarmentBucket> {
  const covered = new Set<SizeGarmentBucket>();
  if (!sizing) return covered;
  if (sizing.topUsualSize?.trim()) covered.add("tops");
  if (sizing.bottomUsualSize?.trim() || sizing.bottomWaist?.trim()) {
    covered.add("bottoms");
  }
  if (
    sizing.shoeEU != null ||
    sizing.shoeUS != null ||
    sizing.shoeUK != null
  ) {
    covered.add("shoes");
  }
  return covered;
}

function sizeLinesFromSizingProfile(
  sizing: {
    topUsualSize?: string | null;
    bottomUsualSize?: string | null;
    bottomWaist?: string | null;
    bottomInseam?: string | null;
    shoeEU?: number | null;
    shoeUS?: number | null;
    shoeUK?: number | null;
  } | null,
): string[] {
  if (!sizing) return [];
  const lines: string[] = [];
  if (sizing.topUsualSize?.trim()) {
    lines.push(`tops ${sizing.topUsualSize.trim()} (account)`);
  }
  if (sizing.bottomUsualSize?.trim()) {
    lines.push(`bottoms ${sizing.bottomUsualSize.trim()} (account)`);
  } else if (sizing.bottomWaist?.trim()) {
    const inseam = sizing.bottomInseam?.trim();
    lines.push(
      inseam
        ? `bottoms W${sizing.bottomWaist.trim()}x${inseam} (account)`
        : `bottoms W${sizing.bottomWaist.trim()} (account)`,
    );
  }
  if (sizing.shoeEU != null) lines.push(`shoes EU${sizing.shoeEU} (account)`);
  else if (sizing.shoeUS != null) lines.push(`shoes US${sizing.shoeUS} (account)`);
  else if (sizing.shoeUK != null) lines.push(`shoes UK${sizing.shoeUK} (account)`);
  return lines;
}

/** Account settings (onboarding) that satisfy intake without fashion_facts rows. */
export async function loadIntakeProfileHints(
  userId: string,
): Promise<IntakeProfileHints | null> {
  if (!isSupabaseAuthUserId(userId)) return null;

  const [profile, sizing] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: { genderPresentation: true, preferredName: true },
    }),
    prisma.sizingProfile.findUnique({
      where: { userId },
      select: {
        topUsualSize: true,
        bottomUsualSize: true,
        bottomWaist: true,
        bottomInseam: true,
        shoeEU: true,
        shoeUS: true,
        shoeUK: true,
      },
    }),
  ]);

  return {
    genderPresentation: genderFromUserProfile(profile?.genderPresentation),
    sizeBuckets: sizeBucketsFromSizingProfile(sizing),
    preferredName: profile?.preferredName?.trim() || null,
    sizeLines: sizeLinesFromSizingProfile(sizing),
  };
}
