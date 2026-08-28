import { z } from "zod";
import { trackProductEvent } from "@/lib/analytics/track";
import { getAuthContext } from "@/lib/auth/session";
import { getSiteUrl } from "@/lib/seo/site";
import type { LookScanPiece } from "@/lib/tryon/look-scan-types";
import { resolveLookScanMode } from "@/lib/tryon/look-scan-types";
import {
  attachLookScanToGeneration,
  loadLookScanForGeneration,
} from "@/lib/tryon/moodboard-context";
import { runLookScanVerdict } from "@/lib/tryon/look-scan-verdict";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    imageUrl: z
      .string()
      .min(1)
      .max(2000)
      .refine(
        (u) => /^https?:\/\//i.test(u) || u.startsWith("/"),
        "imageUrl must be http(s) or absolute path",
      ),
    pieces: z
      .array(
        z
          .object({
            title: z.string().min(1).max(200),
            priceLabel: z.string().max(40).optional(),
            garment: z.string().max(60).optional(),
          })
          .strict(),
      )
      .max(8)
      .default([]),
    lookMode: z.enum(["single_item", "outfit"]).optional(),
    generationId: z.string().min(1).max(80).optional(),
  })
  .strict();

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const pieces: LookScanPiece[] = parsed.data.pieces;
  const lookMode = resolveLookScanMode(pieces, parsed.data.lookMode);

  if (parsed.data.generationId) {
    const cached = await loadLookScanForGeneration({
      userId: auth.userId,
      generationId: parsed.data.generationId,
    });
    if (cached) {
      trackProductEvent({
        name: "look_viewed",
        userId: auth.userId,
        props: {
          generation_id: parsed.data.generationId,
          look_mode: lookMode,
          cached: true,
        },
      });
      return Response.json({
        ok: true,
        verdict: cached,
        lookMode,
        cached: true,
      });
    }
  }

  let imageUrl = parsed.data.imageUrl;
  if (imageUrl.startsWith("/")) {
    // Never use req.url origin — on Railway that is http://0.0.0.0:8080.
    imageUrl = `${getSiteUrl().origin}${imageUrl}`;
  }

  const verdict = await runLookScanVerdict({
    userId: auth.userId,
    imageUrl,
    pieces,
    lookMode,
    signal: req.signal,
  });

  if (!verdict) {
    return Response.json(
      { error: "Couldn't study this look — try again in a moment." },
      { status: 502 },
    );
  }

  if (parsed.data.generationId) {
    await attachLookScanToGeneration({
      userId: auth.userId,
      generationId: parsed.data.generationId,
      verdict,
    }).catch(() => false);
  }

  trackProductEvent({
    name: "look_viewed",
    userId: auth.userId,
    props: {
      generation_id: parsed.data.generationId ?? null,
      look_mode: lookMode,
      cached: false,
    },
  });

  return Response.json({ ok: true, verdict, lookMode });
}
