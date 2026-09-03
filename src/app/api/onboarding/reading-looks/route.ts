import { getAuthContext } from "@/lib/auth/session";
import { prisma } from "@/lib/ai-chat/db";
import { genderFromUserProfile } from "@/lib/fashion-memory/intake/account-profile-bridge";
import { findByHash, findLatestAnalysis } from "@/lib/photo-analysis/store";
import { parseStylistVerdict } from "@/lib/photo-analysis/verdict";
import { groupReadingLooks } from "@/lib/photo-analysis/reading-looks";
import { runReadingLooks } from "@/lib/photo-analysis/run-reading-looks";
import { logVerdict } from "@/lib/photo-analysis/verdict-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  const hash = new URL(req.url).searchParams.get("hash")?.trim() ?? "";
  const row = hash
    ? await findByHash(auth.userId, hash)
    : await findLatestAnalysis(auth.userId);
  const verdict = parseStylistVerdict(row?.verdict);
  if (!verdict) {
    logVerdict("reading-looks skip", { reason: "no_verdict" });
    return Response.json({ items: [] });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId: auth.userId },
    select: {
      genderPresentation: true,
      currency: true,
      shippingCountry: true,
    },
  });

  const started = Date.now();
  const items = await runReadingLooks({
    verdict,
    department: genderFromUserProfile(profile?.genderPresentation ?? null),
    currency: profile?.currency,
    country: profile?.shippingCountry,
    signal: req.signal,
  });
  const grouped = groupReadingLooks(items);
  const face = items.filter(
    (item) => item.kind === "swatch" || item.kind === "avoid",
  );
  logVerdict("reading-looks done", {
    ms: Date.now() - started,
    lookGroups: grouped.looks.length,
    droppedLooks: grouped.droppedLookCount,
    lookProducts: grouped.looks.reduce((n, g) => n + g.products.length, 0),
    buys: grouped.buys.length,
    faceHit: face.filter((item) => item.product).length,
    faceMiss: face.filter((item) => !item.product).length,
  });
  return Response.json({ items });
}
