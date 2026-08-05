import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import type { LookScanPiece } from "@/lib/tryon/look-scan-types";
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
  let imageUrl = parsed.data.imageUrl;
  if (imageUrl.startsWith("/")) {
    const origin = new URL(req.url).origin;
    imageUrl = `${origin}${imageUrl}`;
  }

  const verdict = await runLookScanVerdict({
    userId: auth.userId,
    imageUrl,
    pieces,
    signal: req.signal,
  });

  if (!verdict) {
    return Response.json(
      { error: "Couldn't study this look — try again in a moment." },
      { status: 502 },
    );
  }

  return Response.json({ ok: true, verdict });
}
