import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import {
  checkAvatarAttributes,
  submitAvatarAttributes,
  uploadAvatarPhoto,
} from "@/lib/tryon/avatar/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  if (auth.isGuest) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const personId = String(form.get("person_id") ?? "");
      const file = form.get("photo");
      if (!personId || !(file instanceof Blob)) {
        return Response.json(
          { error: "person_id and photo required." },
          { status: 400 },
        );
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const draft = await uploadAvatarPhoto({
        userId: auth.userId,
        personId,
        bytes,
        contentType: file.type || "image/jpeg",
      });
      return Response.json({ ok: true, draft });
    }

    const json = await req.json();
    const action = z.enum(["check", "attributes"]).parse(json.action);
    const personId = z.string().uuid().parse(json.person_id);

    if (action === "check") {
      const draft = await checkAvatarAttributes({
        userId: auth.userId,
        personId,
        statedAttributes: json.attributes,
        traceId: json.trace_id,
      });
      return Response.json({ ok: true, draft });
    }
    const draft = await submitAvatarAttributes({
      userId: auth.userId,
      personId,
      attributes: json.attributes,
    });
    return Response.json({ ok: true, draft });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Avatar upload failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
