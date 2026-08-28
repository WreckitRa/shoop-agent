import { z } from "zod";
import { trackProductEvent } from "@/lib/analytics/track";
import { getAuthContext } from "@/lib/auth/session";
import { applyStatedMeasurements } from "@/lib/fashion-memory/intake/apply-stated-measurements";
import { inspectPhotoBytes } from "@/lib/photo-analysis/inspect-photo";
import {
  PhotoUploadCapError,
  assertPhotoUploadCaps,
} from "@/lib/photo-analysis/upload-caps";
import { requireAvatarOwner } from "@/lib/tryon/avatar/request-auth";
import {
  checkAvatarAttributes,
  submitAvatarAttributes,
  uploadAvatarPhoto,
} from "@/lib/tryon/avatar/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const measurementSchema = z.object({
  metric: z.enum(["height", "neck", "chest", "waist", "hips", "inseam"]),
  value: z.number().positive(),
  unit: z.enum(["cm", "in"]),
});

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const owner = await requireAvatarOwner(req, auth);
  if (!owner.ok) return owner.response;

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
      const bytes = Buffer.from(await file.arrayBuffer());
      const inspected = inspectPhotoBytes(bytes);
      if (!inspected.ok) {
        return Response.json({ error: inspected.error }, { status: inspected.status });
      }
      try {
        await assertPhotoUploadCaps({ userId: auth.userId, req });
      } catch (error) {
        if (error instanceof PhotoUploadCapError) {
          return Response.json({ error: error.message }, { status: error.status });
        }
        throw error;
      }
      const draft = await uploadAvatarPhoto({
        userId: owner.userId,
        personId,
        bytes: new Uint8Array(bytes),
        contentType: inspected.contentType,
      });
      trackProductEvent({
        name: "photo_uploaded",
        userId: auth.userId,
        props: {
          source: "avatar",
          person_id: personId,
        },
      });
      return Response.json({ ok: true, draft });
    }

    const json = await req.json();
    const action = z
      .enum(["check", "attributes", "measurements"])
      .parse(json.action);
    const personId = z.string().uuid().parse(json.person_id);

    if (action === "check") {
      const draft = await checkAvatarAttributes({
        userId: owner.userId,
        personId,
        statedAttributes: json.attributes,
        traceId: json.trace_id,
      });
      return Response.json({ ok: true, draft });
    }

    if (action === "measurements") {
      const measurements = z.array(measurementSchema).parse(json.measurements ?? []);
      const written = await applyStatedMeasurements({
        userId: owner.userId,
        personId,
        measurements,
      });
      return Response.json({
        ok: true,
        written: written.length,
        measurements_on_file: written.length,
      });
    }

    const draft = await submitAvatarAttributes({
      userId: owner.userId,
      personId,
      attributes: json.attributes,
    });
    return Response.json({ ok: true, draft });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Avatar upload failed.";
    console.error("[shoop] avatar upload failed", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
