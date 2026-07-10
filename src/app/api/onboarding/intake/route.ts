import { extractShoppingMemory } from "@/lib/ai-chat/shopping-memory/extractor";
import { projectExtractionToTypedTables } from "@/lib/ai-chat/shopping-memory/projector";
import { refreshShoppingProfileSummary } from "@/lib/ai-chat/shopping-memory/summary";
import { writeMemoryFromExtraction } from "@/lib/ai-chat/shopping-memory/writer";
import {
  buildOnboardingPatchFromPrefill,
  mergeOnboardingPrefill,
} from "@/lib/onboarding/prefill";
import { getAuthContext } from "@/lib/auth/session";
import {
  applyOnboardingPatch,
  getOnboardingStatus,
  markOnboardingStarted,
  onboardingIntakeSchema,
} from "@/lib/onboarding/status";

const ONBOARDING_INTAKE_PREFIX = `The user pasted a structured shopping profile document (markdown headings are common).
Extract EVERY fact into separate observations for onboarding. Include name, gender presentation if stated,
all sizes (topSize, bottomUsualSize or waist/inseam, shoeSizeEU), style tasteTags, brands, hard negatives,
owned products, and valuePhilosophy. Emit many observations (not one summary blob).
Do NOT include profileUpdates or activeIntent — only isShoppingRelevant and observations.
Keep normalizedText short; avoid repeating the same facts in attributes.

Profile document:
`;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = onboardingIntakeSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid body.", issues: parsed.error.flatten() }, { status: 400 });
    }

    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    await markOnboardingStarted(userId);

    const intakeText = parsed.data.text;
    const extraction = await extractShoppingMemory(
      ONBOARDING_INTAKE_PREFIX + intakeText,
      req.signal,
      {
        maxTokens: 8192,
        audit: {
          userId,
          kind: "memory_extract",
          sequence: 0,
          metadata: { source: "onboarding_intake" },
        },
      },
    );

    const prefill = mergeOnboardingPrefill(intakeText, extraction);
    const prefillPatch = buildOnboardingPatchFromPrefill(prefill);
    if (Object.keys(prefillPatch).length > 0) {
      await applyOnboardingPatch(prefillPatch, userId);
    }

    if (extraction) {
      await writeMemoryFromExtraction(userId, null, null, extraction);
      await projectExtractionToTypedTables({ userId, extraction });
      await refreshShoppingProfileSummary(userId).catch(() => {});
    }

    return Response.json({
      prefill,
      extraction: extraction
        ? {
            observations: extraction.observations.length,
            hasActiveIntent: Boolean(extraction.activeIntent),
            hasProfileUpdates: Boolean(extraction.profileUpdates),
          }
        : null,
      ...(await getOnboardingStatus(userId)),
    });
  } catch {
    return Response.json({ error: "Could not extract onboarding details." }, { status: 500 });
  }
}
