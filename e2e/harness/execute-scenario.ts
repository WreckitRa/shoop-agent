import { randomUUID } from "node:crypto";
import {
  emptyGuestFashionMemorySnapshot,
  FashionLocalStore,
  type GuestFashionMemorySnapshot,
} from "@/lib/fashion-memory/local/store";
import { buildRouterContextFromData } from "@/lib/fashion-memory/router/router-context-format";
import { resolveFashionRouterTurn } from "@/lib/fashion-memory/intake/post-router";
import { planSearchFromBrief } from "@/lib/fashion-memory/search-planner/plan-from-brief";
import {
  fashionCatalogSearchToMetadata,
  searchFashionCatalogPlan,
} from "@/lib/fashion-memory/catalog-search";
import { buildRenderContract } from "@/lib/fashion-memory/curation/build-render-contract";
import { curationMessageFromSlots } from "./curation-recording";
import {
  clearSearchPoolMemoryStore,
  setPoolStoreMode,
} from "@/lib/fashion-memory/hydration/pool-persistence";
import {
  clearInteractionSignalDedup,
  setTestSignalCapture,
} from "@/lib/fashion-memory/curation/interaction-signals";
import {
  setTestPipelineEventCapture,
  type CapturedPipelineEvent,
} from "@/lib/fashion-memory/observability/trace";
import { setCatalogClientOverride } from "@/lib/shopify/catalog-client-override";
import { setCatalogAccessTokenOverride } from "@/lib/shopify/catalog-auth";
import {
  createFakeUcpClient,
  shopDepartmentRowsFromSeed,
} from "../../test/fake-ucp/fake-client";
import type { FakeUcpRuntime } from "../../test/fake-ucp/types";
import {
  resetShopDepartmentCacheForTests,
  setShopDepartmentIndexForTests,
} from "@/lib/fashion-memory/shop-departments";
import type {
  E2eMode,
  E2eScenario,
  ScenarioRunResult,
  TurnArtifacts,
} from "../types";
import { createLlmMock, createEmptyLlmCounter } from "./llm-mock";
import { evaluateExpectations, compactTraceDump, buildPayloadFingerprint } from "./evaluate";
import { buildStructuralTrace, diffGoldenPayloads } from "./golden-trace";
import { advanceFakeClock, setFakeNow } from "./clock";
import { persistSearchTurn } from "./persist-turn";
import { runInteractionStep } from "./interactions";
import {
  createInMemoryPrismaStore,
  installInMemoryPrisma,
  uninstallInMemoryPrisma,
} from "./in-memory-prisma";
import { seedE2eConversation } from "./persist-turn";
import { consumeFashionSseStream, artifactsFromSse } from "./sse-turn";

export const GUEST_USER = "guest-e2e-00000000-0000-4000-8000-000000000001";

function conversationIdFor(scenario: E2eScenario): string {
  return `conv_e2e_${scenario.name}`;
}

function seedGuestSnapshot(seed: E2eScenario["seed"]): GuestFashionMemorySnapshot {
  const snapshot = emptyGuestFashionMemorySnapshot();
  const store = new FashionLocalStore(snapshot);
  const selfId = store.ensureSelfPerson(GUEST_USER);
  if (seed.profile_state?.preferredName) {
    const person = snapshot.people.find((p) => p.id === selfId);
    if (person) person.name = seed.profile_state.preferredName;
  }
  if (seed.profile_state?.genderPresentation) {
    store.upsertFashionFact({
      userId: GUEST_USER,
      personId: selfId,
      factType: "gender_presentation",
      value: { presentation: seed.profile_state.genderPresentation },
    });
  }
  for (const line of seed.profile_state?.sizeLines ?? []) {
    const m = /^(tops|bottoms|shoes)\s+(.+)$/i.exec(line.trim());
    if (!m) continue;
    const bucket = m[1]!.toLowerCase();
    const size = m[2]!.trim();
    const garment =
      bucket === "tops" ? "shirt" : bucket === "bottoms" ? "trousers" : "shoes";
    store.upsertFashionFact({
      userId: GUEST_USER,
      personId: selfId,
      factType: "size",
      garmentType: garment,
      value: { label: size, system: "us" },
    });
  }
  if (
    seed.profile_state?.genderPresentation === "mens" &&
    !(seed.profile_state?.sizeLines?.length)
  ) {
    for (const [garment, label] of [
      ["shirt", "M"],
      ["trousers", "33"],
      ["shoes", "10"],
    ] as const) {
      store.upsertFashionFact({
        userId: GUEST_USER,
        personId: selfId,
        factType: "size",
        garmentType: garment,
        value: { label, system: "us" },
      });
    }
  }
  for (const sig of seed.prior_signals ?? []) {
    snapshot.style_signals.push({
      id: randomUUID(),
      user_id: GUEST_USER,
      person_id: selfId,
      attribute_type: sig.attribute_type as "color",
      attribute_value: sig.attribute_value,
      polarity: sig.polarity,
      source: "interaction",
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  return snapshot;
}

function buildContext(
  snapshot: GuestFashionMemorySnapshot,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
) {
  const self = snapshot.people.find((p) => p.relation === "self");
  const factsByPersonId = new Map<string, typeof snapshot.fashion_facts>();
  const signalsByPersonId = new Map<string, typeof snapshot.style_signals>();
  if (self) {
    factsByPersonId.set(
      self.id,
      snapshot.fashion_facts.filter((f) => f.person_id === self.id),
    );
    signalsByPersonId.set(
      self.id,
      snapshot.style_signals.filter((s) => s.person_id === self.id),
    );
  }
  return buildRouterContextFromData({
    people: snapshot.people,
    factsByPersonId,
    signalsByPersonId,
    conversationMessages: messages,
    stickyPersonIds: self ? [self.id] : [],
    now: new Date("2026-07-13T12:00:00Z"),
    accountHints: {
      genderPresentation: seedPresentation(snapshot),
      preferredName: self?.name ?? "Guest",
      sizeLines: [],
    },
  });
}

function seedPresentation(snapshot: GuestFashionMemorySnapshot): string {
  const self = snapshot.people.find((p) => p.relation === "self");
  if (!self) return "mens";
  const fact = snapshot.fashion_facts.find(
    (f) => f.person_id === self.id && f.fact_type === "gender_presentation",
  );
  const val = fact?.value as { presentation?: string } | undefined;
  return val?.presentation ?? "mens";
}

function applyShopDepartments(seed: E2eScenario["seed"]) {
  resetShopDepartmentCacheForTests();
  if (seed.shop_departments && Object.keys(seed.shop_departments).length) {
    setShopDepartmentIndexForTests(shopDepartmentRowsFromSeed(seed.shop_departments));
  }
}

async function runUserStepPipeline(
  scenario: E2eScenario,
  state: {
    snapshot: GuestFashionMemorySnapshot;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    artifacts: TurnArtifacts;
    ucpRuntime: FakeUcpRuntime;
    llmMock: ReturnType<typeof createLlmMock>;
    prismaStore: ReturnType<typeof createInMemoryPrismaStore>;
    conversationId: string;
  },
  text: string,
): Promise<void> {
  state.messages.push({ role: "user", content: text });
  const traceId = state.artifacts.traceId;
  const routerContext = buildContext(state.snapshot, state.messages);

  const resolved = await resolveFashionRouterTurn({
    conversationId: state.conversationId,
    userId: GUEST_USER,
    routerContext,
    guestSnapshot: state.snapshot,
    traceId,
    lastUserMessage: text,
    deps: { createMessage: state.llmMock },
  });

  state.artifacts.routerResult = resolved.routerResult;
  state.artifacts.brief = resolved.routerResult.move === "ready_to_search"
    ? resolved.routerResult.brief
    : state.artifacts.brief;

  if (resolved.routerResult.move === "ask_clarification") {
    state.messages.push({ role: "assistant", content: resolved.routerResult.reply });
    return;
  }
  if (resolved.routerResult.move !== "ready_to_search") return;

  const recipientId =
    resolved.recipientPersonId ??
    state.snapshot.people.find((p) => p.relation === "self")?.id ??
    "";

  const planned = await planSearchFromBrief({
    brief: resolved.routerResult.brief,
    userId: GUEST_USER,
    recipientPersonId: recipientId,
    currentDate: routerContext.currentDate,
    guestSnapshot: state.snapshot,
    traceId,
    plannerDeps: { createMessage: state.llmMock },
  });
  const plan = planned.plan;
  state.artifacts.plan = plan;

  const useRefAligned = scenario.ref_aligned_curation !== false;
  const catalog = await searchFashionCatalogPlan({
    plan,
    profile: {
      countryCode: "US",
      currency: "USD",
      language: "en",
      positiveSignals: state.snapshot.style_signals
        .filter((s) => s.polarity > 0)
        .map((s) => s.attribute_value),
    },
    recipientProfile: planned.recipientProfile,
    accessToken: "fake-token",
    recipientFacts: [],
    traceId,
    searchId: state.artifacts.searchId,
    userId: GUEST_USER,
    createMessage: state.llmMock,
    resolveCurationMessage: useRefAligned
      ? ({ slots }) =>
          curationMessageFromSlots({
            plan,
            slots,
            options: scenario.curation_options,
          })
      : undefined,
  });

  state.artifacts.catalog = catalog;
  if (catalog.curation && plan) {
    state.artifacts.render = buildRenderContract({
      presentation: catalog.curation,
      plan,
    });
  }

  void fashionCatalogSearchToMetadata(catalog, { trace_id: traceId });
  state.ucpRuntime.stepIndex += 1;
  persistSearchTurn({
    store: state.prismaStore,
    artifacts: state.artifacts,
    conversationId: state.conversationId,
    userId: GUEST_USER,
  });
}

async function runUserStepSse(
  scenario: E2eScenario,
  state: {
    snapshot: GuestFashionMemorySnapshot;
    artifacts: TurnArtifacts;
    llmMock: ReturnType<typeof createLlmMock>;
    prismaStore: ReturnType<typeof createInMemoryPrismaStore>;
    conversationId: string;
  },
  text: string,
): Promise<void> {
  const sse = await consumeFashionSseStream({
    userId: GUEST_USER,
    message: text,
    conversationId: state.conversationId,
    guestSnapshot: state.snapshot,
    scenario,
    llmMock: state.llmMock,
  });
  state.artifacts.sseEvents = sse.events;
  state.artifacts.conversationId = sse.conversationId ?? state.artifacts.conversationId;
  if (sse.assistantMessageId) state.artifacts.searchId = sse.assistantMessageId;
  if (sse.traceId) state.artifacts.traceId = sse.traceId;

  const partial = artifactsFromSse(sse.events);
  Object.assign(state.artifacts, partial);
  if (state.artifacts.catalog?.curation && state.artifacts.plan) {
    state.artifacts.render = buildRenderContract({
      presentation: state.artifacts.catalog.curation,
      plan: state.artifacts.plan,
    });
  }
  persistSearchTurn({
    store: state.prismaStore,
    artifacts: state.artifacts,
    conversationId: state.conversationId,
    userId: GUEST_USER,
  });
}

export async function executeScenario(
  scenario: E2eScenario,
  mode: E2eMode,
): Promise<ScenarioRunResult> {
  setPoolStoreMode("memory");
  clearSearchPoolMemoryStore();
  clearInteractionSignalDedup();
  applyShopDepartments(scenario.seed);

  const prismaStore = createInMemoryPrismaStore();
  installInMemoryPrisma(prismaStore, { userId: GUEST_USER });
  const conversationId = conversationIdFor(scenario);
  seedE2eConversation({
    store: prismaStore,
    conversationId,
    userId: GUEST_USER,
  });
  setCatalogAccessTokenOverride("fake-e2e-token");

  const pipelineEvents: CapturedPipelineEvent[] = [];
  setTestPipelineEventCapture(pipelineEvents);

  const signalCapture: Array<{ signalType: string; value: string; polarity: number }> = [];
  setTestSignalCapture(
    signalCapture as Parameters<typeof setTestSignalCapture>[0],
  );

  const ucpRuntime: FakeUcpRuntime = {
    catalog: scenario.catalog,
    stepIndex: 0,
    getProductCalls: 0,
  };
  setCatalogClientOverride(createFakeUcpClient(ucpRuntime));

  const llmCounter = createEmptyLlmCounter();
  const llmMock = createLlmMock(mode, scenario.llm_recordings ?? {}, llmCounter);
  const traceId = randomUUID();
  const searchId = `msg_${scenario.name}`;

  const snapshot = seedGuestSnapshot(scenario.seed);
  const artifacts: TurnArtifacts = {
    guestSnapshot: snapshot,
    traceId,
    searchId,
    pipelineEvents: [],
    signals: signalCapture,
    llmCounter,
    conversationId,
  };

  const state = {
    snapshot,
    messages: [] as Array<{ role: "user" | "assistant"; content: string }>,
    artifacts,
    ucpRuntime,
    llmMock,
    pipelineEvents,
    signalCapture,
    prismaStore,
    conversationId,
  };

  const failures: string[] = [];

  try {
    for (const step of scenario.steps) {
      if ("user" in step) {
        if (scenario.use_sse) {
          await runUserStepSse(scenario, state, step.user);
        } else {
          await runUserStepPipeline(scenario, state, step.user);
        }
        failures.push(...evaluateExpectations(step.expect, artifacts));
      } else if ("interact" in step) {
        const err = await runInteractionStep({
          interact: step.interact,
          artifacts,
          userId: GUEST_USER,
          ucpRuntime,
          llmMock,
          prismaStore,
          useHandlers: Boolean(prismaStore.messages.get(artifacts.searchId)?.metadata),
        });
        if (err) failures.push(err);
        failures.push(...evaluateExpectations(step.expect, artifacts));
      } else if ("simulate" in step) {
        if (step.simulate === "restart") {
          clearSearchPoolMemoryStore();
        }
        if (step.simulate === "advance_clock") {
          advanceFakeClock(step.args?.hours ?? 25);
        }
        failures.push(...evaluateExpectations(step.expect, artifacts));
      }
      artifacts.pipelineEvents = pipelineEvents.map((e) => ({
        stage: e.stage,
        payload: e.payload,
      }));
    }
  } finally {
    setCatalogClientOverride(null);
    setCatalogAccessTokenOverride(null);
    setTestPipelineEventCapture(null);
    setTestSignalCapture(null);
    resetShopDepartmentCacheForTests();
    uninstallInMemoryPrisma();
    setFakeNow(null);
  }

  const structuralTrace = buildStructuralTrace(artifacts.pipelineEvents);
  const payloadFingerprint = buildPayloadFingerprint(artifacts);

  if (scenario.golden_payloads) {
    failures.push(...diffGoldenPayloads(scenario.golden_payloads, payloadFingerprint));
  }

  if (failures.length) {
    const dump = compactTraceDump(artifacts);
    failures.push(`trace_dump: ${JSON.stringify(dump)}`);
    failures.push(`trace_id: ${artifacts.traceId}`);
  }

  return {
    scenario: scenario.name,
    ok: failures.length === 0,
    failures,
    traceId: artifacts.traceId,
    artifacts,
    structuralTrace,
    payloadFingerprint,
  };
}
