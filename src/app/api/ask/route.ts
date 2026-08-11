import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { createLookAskShare } from "@/lib/ask/create-share";
import { getSiteUrl } from "@/lib/seo/site";

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
    generationId: z.string().max(80).optional().nullable(),
    conversationId: z.string().max(80).optional().nullable(),
    killCount: z.number().int().min(0).max(9999).optional().nullable(),
    ownerVote: z.enum(["no", "meh", "almost", "love"]).optional().nullable(),
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
    verdict: z
      .object({
        verdict_title: z.string().min(1).max(80),
        verdict_body: z.string().min(1).max(600),
        annotations: z.array(z.string().min(1).max(48)).length(4),
        whispers: z.array(z.string().min(1).max(120)).length(4),
        checks: z.object({
          fit: z.enum(["pass", "caution", "fail"]),
          palette: z.enum(["pass", "caution", "fail"]),
          nolist: z.enum(["pass", "caution", "fail"]),
        }),
        vote: z.enum(["no", "meh", "almost", "love"]).optional(),
      })
      .strict(),
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

  const publicOrigin = getSiteUrl().origin;
  let imageUrl = parsed.data.imageUrl;
  if (imageUrl.startsWith("/")) {
    // Never use req.url origin — on Railway that is http://0.0.0.0:8080.
    imageUrl = `${publicOrigin}${imageUrl}`;
  }

  try {
    const share = await createLookAskShare({
      userId: auth.userId,
      imageUrl,
      pieces: parsed.data.pieces,
      verdict: {
        ...parsed.data.verdict,
        annotations: parsed.data.verdict.annotations as [
          string,
          string,
          string,
          string,
        ],
        whispers: parsed.data.verdict.whispers as [
          string,
          string,
          string,
          string,
        ],
      },
      generationId: parsed.data.generationId,
      conversationId: parsed.data.conversationId,
      killCount: parsed.data.killCount,
      ownerVote: parsed.data.ownerVote,
    });

    const askPath = `/ask/${share.token}`;
    return Response.json({
      ok: true,
      shareId: share.id,
      token: share.token,
      askPath,
      url: `${publicOrigin}${askPath}`,
      serial: share.serial,
      messageId: share.messageId,
    });
  } catch (error) {
    console.error("[ask] create failed", error);
    return Response.json(
      { error: "Couldn't create the share link." },
      { status: 500 },
    );
  }
}
