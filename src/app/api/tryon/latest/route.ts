import { getAuthContext } from "@/lib/auth/session";
import { ensureSelfPerson } from "@/lib/fashion-memory/people";
import { getStoredAvatar } from "@/lib/tryon/avatar/service";
import { findLatestCompletedTryon } from "@/lib/tryon/generations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  if (auth.isGuest) {
    return Response.json({ error: "Sign in to view try-ons." }, { status: 401 });
  }

  try {
    const self = await ensureSelfPerson(auth.userId);
    const avatar = await getStoredAvatar(auth.userId, self.id);
    const latest = await findLatestCompletedTryon(auth.userId);

    const kind =
      latest?.kind === "outfit"
        ? "look"
        : latest?.kind === "single"
          ? "item"
          : null;

    return Response.json({
      ok: true,
      avatar_url: avatar?.url ?? null,
      has_avatar: Boolean(avatar?.url || avatar?.storage_path),
      tryon: latest?.outputUrl
        ? {
            job_id: latest.id,
            image_url: latest.outputUrl,
            kind,
            search_id: latest.searchId,
            ref: latest.productRef,
            look_id: latest.lookId,
            title:
              latest.lookId?.trim() ||
              (kind === "look" ? "Your last look" : "Your last try-on"),
          }
        : null,
    });
  } catch {
    return Response.json({ error: "Could not load try-on." }, { status: 500 });
  }
}
