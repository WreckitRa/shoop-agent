import {
  handleFashionPickAction,
  handleRecurate,
} from "@/lib/fashion-memory/curation/interaction-handlers";
import { loadSlotPool } from "@/lib/fashion-memory/hydration/pool-persistence";
import { rejectPick, promotePick } from "@/lib/fashion-memory/curation/picks-actions";
import type { TurnArtifacts } from "../types";
import type { FakeUcpRuntime } from "../../test/fake-ucp/types";
import type { createLlmMock } from "./llm-mock";
import type { InMemoryPrismaStore } from "./in-memory-prisma";
import { prisma } from "@/lib/ai-chat/db";

async function readJsonResponse(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

export async function runInteractionStep(params: {
  interact: {
    kind: "reject" | "promote" | "look_swap" | "show_more" | "verify" | "recurate";
    ref?: string;
    demotedRef?: string;
    slotId?: string;
  };
  artifacts: TurnArtifacts;
  userId: string;
  ucpRuntime: FakeUcpRuntime;
  llmMock: ReturnType<typeof createLlmMock>;
  prismaStore: InMemoryPrismaStore;
  useHandlers?: boolean;
}): Promise<string | null> {
  const { artifacts, interact } = params;
  const plan = artifacts.plan;
  const catalog = artifacts.catalog;
  if (!plan || !catalog?.curation) {
    return "interaction: missing plan or curation";
  }

  const curation = catalog.curation;
  const slotId = interact.slotId ?? plan.slots[0]?.slot_id ?? "shirt";

  if (params.useHandlers) {
    if (interact.kind === "reject") {
      const ref = interact.ref ?? curation.tiers.picks[0]?.ref;
      if (!ref) return "interaction.reject: no pick ref";
      const res = await handleFashionPickAction(
        "reject",
        { messageId: artifacts.searchId, ref },
        params.userId,
      );
      if (!res.ok) {
        const body = await readJsonResponse(res);
        return `interaction.reject: ${String(body.error ?? res.status)}`;
      }
      const body = await readJsonResponse(res);
      if (body.curation) {
        artifacts.catalog = { ...catalog, curation: body.curation as typeof curation };
      }
      return null;
    }

    if (interact.kind === "promote") {
      const ref = interact.ref ?? curation.tiers.verified[0]?.ref;
      if (!ref) return "interaction.promote: no verified ref";
      const res = await handleFashionPickAction(
        "promote",
        { messageId: artifacts.searchId, ref, demotedRef: interact.demotedRef },
        params.userId,
      );
      const body = await readJsonResponse(res);
      if (!res.ok && !body.ok) {
        return `interaction.promote: ${String(body.error ?? body.user_line ?? res.status)}`;
      }
      if (body.curation) {
        artifacts.catalog = { ...catalog, curation: body.curation as typeof curation };
      }
      return null;
    }

    if (interact.kind === "recurate") {
      const res = await handleRecurate(
        { messageId: artifacts.searchId },
        params.userId,
      );
      const body = await readJsonResponse(res);
      if (!res.ok) {
        return `interaction.recurate: ${String(body.error ?? res.status)}`;
      }
      if (body.curation) {
        artifacts.catalog = { ...catalog, curation: body.curation as typeof curation };
      }
      return null;
    }
  }

  // Fallback: in-memory pick mutations without persisted message row
  if (interact.kind === "reject") {
    const ref = interact.ref ?? curation.tiers.picks[0]?.ref;
    if (!ref) return "interaction.reject: no pick ref";
    const { state } = rejectPick({ state: curation, ref });
    artifacts.catalog = { ...catalog, curation: state };
    const pool = await loadSlotPool({
      searchId: artifacts.searchId,
      slotId,
      userId: params.userId,
    });
    if (pool) {
      const entry = [...curation.tiers.picks, ...curation.tiers.verified].find(
        (p) => p.ref === ref,
      );
      if (entry?.id) {
        await pool.reportDeath(entry.id, "user_reject", "reject");
        await pool.persist();
      }
    }
    return null;
  }

  if (interact.kind === "promote") {
    const ref = interact.ref ?? curation.tiers.verified[0]?.ref;
    if (!ref) return "interaction.promote: no verified ref";
    const next = promotePick({
      state: curation,
      ref,
      demotedRef: interact.demotedRef,
    });
    artifacts.catalog = { ...catalog, curation: next };
    return null;
  }

  params.ucpRuntime.stepIndex += 1;
  void params.llmMock;
  void prisma;
  return null;
}
