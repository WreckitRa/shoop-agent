import { prisma } from "@/lib/ai-chat/db";
import { sizingProfilePatchSchema } from "@/lib/ai-chat/profile/validators";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";
import { getAuthContext } from "@/lib/auth/session";

export async function GET() {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const row = await prisma.sizingProfile.findUnique({
      where: { userId: userId },
    });
    return Response.json({ sizing: row });
  } catch {
    return Response.json({ error: "Could not load sizing." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const raw = await req.json();
    const parsed = sizingProfilePatchSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid body.", issues: parsed.error.flatten() }, { status: 400 });
    }

    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const body = parsed.data;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      if (k === "brandSizingNotes") {
        data[k] = (v ?? []) as InputJsonValue;
        continue;
      }
      data[k] = v;
    }

    const row = await prisma.sizingProfile.upsert({
      where: { userId },
      create: { userId, ...data, confidence: 1, evidenceCount: 1 },
      update: { ...data, confidence: 1, evidenceCount: { increment: 1 } },
    });

    return Response.json({ sizing: row });
  } catch {
    return Response.json({ error: "Could not update sizing." }, { status: 500 });
  }
}
