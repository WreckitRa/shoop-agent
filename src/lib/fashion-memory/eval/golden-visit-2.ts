import { randomUUID } from "node:crypto";
import type { ProductCard } from "@/lib/ai-chat/types";
import { FashionLocalStore } from "@/lib/fashion-memory/local/store";
import { writePurchaseMemory } from "@/lib/fashion-memory/purchase";
import { writeRequestEventFromBrief } from "@/lib/fashion-memory/router/assemble-router-context";
import { requestAttributesFromBrief } from "@/lib/fashion-memory/router/request-event-from-brief";
import { runClerk } from "@/lib/fashion-memory/eval-memory/clerk";
import type { CheckResult } from "./checks";
import {
  consultQuestionCount,
  userFacingAssistantText,
} from "./checks";
import type { Persona } from "./persona";
import { personaSchema } from "./persona";
import { seedPersonaSnapshot } from "./seed-profile";
import {
  persistEvalUserTurn,
  runPersonaAppointment,
  type EvalStage,
  type PersonaRunResult,
  type TranscriptTurn,
} from "./run-persona";
import type { InMemoryPrismaStore } from "../../../../e2e/harness/in-memory-prisma";

export const GOLDEN_VISIT_2_ID = "golden-visit-2";

const PERCIVAL: ProductCard = {
  id: "golden-visit-2-percival",
  title: "Navy Percival shirt",
  catalogAttributes: [
    { name: "color", value: "navy" },
    { name: "brand", value: "percival" },
    { name: "garment", value: "shirt" },
  ],
};

const VISIT_1_PERSONA: Persona = personaSchema.parse({
  id: "golden-visit-2-v1",
  name: "Alex",
  language: "en",
  patience: "normal",
  volunteers: "little",
  profile: {
    state: "new",
    department: "mens",
    sizes: { tops: "M", bottoms: "32", shoes: "43" },
  },
  truth: {
    request_type: "single_item",
    garments: ["shirt"],
    occasion: "client dinner thursday",
    depth: { options: 3 },
    anchor: "n/a",
  },
  opening_message: "need a shirt for a client dinner thursday",
});

export const GOLDEN_VISIT_2_PERSONA: Persona = personaSchema.parse({
  id: GOLDEN_VISIT_2_ID,
  name: "Alex",
  language: "en",
  patience: "normal",
  volunteers: "little",
  profile: {
    state: "known_relevant",
    department: "mens",
    sizes: { tops: "M", bottoms: "32", shoes: "43" },
  },
  truth: {
    request_type: "single_item",
    garments: ["shirt"],
    occasion: "dinner",
    depth: { options: 3 },
    anchor: "keep",
  },
  opening_message: "got another dinner coming up",
});

export function purchaseRecalled(facing: string): boolean {
  return /percival/i.test(facing) && /navy/i.test(facing);
}

export function stripeLeaksUserFacing(facing: string): boolean {
  return /strip/i.test(facing);
}

export function visit2Checks(params: {
  visit1: { transcript: TranscriptTurn[] };
  visit2: { transcript: TranscriptTurn[] };
  extractionDone: boolean;
}): CheckResult[] {
  const facing = userFacingAssistantText(params.visit2.transcript);
  const v1Consult = consultQuestionCount(params.visit1.transcript);
  const v2Consult = consultQuestionCount(params.visit2.transcript);
  const visit2NonAnchorAsk = params.visit2.transcript.some(
    (t) =>
      t.router?.move === "ask_clarification" &&
      t.router.questions.some((q: { gap: string }) => q.gap !== "preference_anchor"),
  );
  const depthReasked = params.visit2.transcript.some(
    (t) =>
      t.router?.move === "ask_clarification" &&
      t.router.questions.some((q: { gap: string }) => q.gap === "depth"),
  );
  return [
    {
      id: "extraction_finished",
      pass: params.extractionDone,
      reason: params.extractionDone
        ? "visit 1 extraction run finished"
        : "visit 1 extraction did not finish before visit 2",
    },
    {
      id: "purchase_recalled",
      pass: purchaseRecalled(facing),
      reason: purchaseRecalled(facing)
        ? "known_summary or consult copy names the navy Percival"
        : "navy Percival missing from visit 2 user-facing copy",
    },
    {
      id: "fewer_consults",
      pass: v2Consult === 0,
      reason: `consults excluding preference_anchor visit1=${v1Consult} visit2=${v2Consult}`,
    },
    {
      id: "visit2_anchor_only",
      pass: !visit2NonAnchorAsk,
      reason: visit2NonAnchorAsk
        ? "visit 2 asked something other than preference_anchor"
        : "visit 2 asked only the preference_anchor",
    },
    {
      id: "no_depth_reask",
      pass: !depthReasked,
      reason: depthReasked
        ? "depth asked again on visit 2"
        : "depth not re-asked",
    },
    {
      id: "no_stripe_user_facing",
      pass: !stripeLeaksUserFacing(facing),
      reason: stripeLeaksUserFacing(facing)
        ? "striped rejection leaked into user-facing copy"
        : "striped candidate not user-facing",
    },
  ];
}

export async function runGoldenVisit2(params: {
  stage: EvalStage;
  store: InMemoryPrismaStore;
}): Promise<{
  result: PersonaRunResult;
  extraChecks: CheckResult[];
}> {
  const userId = `guest-eval-${GOLDEN_VISIT_2_ID}`;
  const { snapshot } = seedPersonaSnapshot(VISIT_1_PERSONA, userId);
  let extractionDone = false;

  const visit1 = await runPersonaAppointment({
    persona: VISIT_1_PERSONA,
    stage: params.stage,
    store: params.store,
    userId,
    snapshot,
    afterReadyToSearch: async (ctx) => {
      const self = ctx.snapshot.people.find((p) => p.relation === "self");
      const personId = ctx.recipientPersonId ?? self?.id;
      if (!personId) {
        throw new Error("golden-visit-2: no recipient for request event");
      }
      await writeRequestEventFromBrief({
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        personId,
        attributes: {
          ...requestAttributesFromBrief(ctx.brief),
          search_id: ctx.searchId,
        },
        guestSnapshot: ctx.snapshot,
      });
      ctx.turnMessages.push(
        persistEvalUserTurn({
          store: ctx.store,
          conversationId: ctx.conversationId,
          content: "not the striped one",
        }),
      );
      const local = new FashionLocalStore(ctx.snapshot);
      await runClerk({
        session: { kind: "local", userId: ctx.userId, local },
        conversationId: ctx.conversationId,
        messages: ctx.turnMessages,
        traceId: ctx.traceId,
      });
      extractionDone =
        local.getLatestExtractionRun({
          userId: ctx.userId,
          conversationId: ctx.conversationId,
        })?.status === "done";
      await writePurchaseMemory({
        userId: ctx.userId,
        searchId: ctx.searchId,
        ref: PERCIVAL.id,
        product: PERCIVAL,
        guestSnapshot: ctx.snapshot,
      });
    },
  });

  const visit2 = await runPersonaAppointment({
    persona: GOLDEN_VISIT_2_PERSONA,
    stage: params.stage,
    store: params.store,
    userId,
    conversationId: `conv_eval_${GOLDEN_VISIT_2_ID}_v2_${randomUUID().slice(0, 8)}`,
    snapshot,
  });

  return {
    result: {
      ...visit2,
      visit1_transcript: visit1.transcript,
    },
    extraChecks: visit2Checks({
      visit1,
      visit2,
      extractionDone,
    }),
  };
}
