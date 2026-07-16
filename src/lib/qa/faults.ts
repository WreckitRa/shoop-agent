import { AsyncLocalStorage } from "node:async_hooks";
import { recordPipelineEvent } from "@/lib/fashion-memory/observability/trace";
import { isQaDevEnvironment } from "./guard";

const qaConversationContext = new AsyncLocalStorage<{ conversationId: string }>();

/** Bind conversation id for the current fashion turn (fault injection scope). */
export function runWithQaConversation<T>(conversationId: string, fn: () => T): T {
  return qaConversationContext.run({ conversationId }, fn);
}

export function enterQaConversation(conversationId: string): void {
  qaConversationContext.enterWith({ conversationId });
}

export function activeQaConversationId(): string | null {
  return qaConversationContext.getStore()?.conversationId ?? null;
}

export type QaFaultName =
  | "force_curation_timeout"
  | "force_curation_invalid"
  | "kill_next_hydration"
  | "fail_one_lane";

export type QaFaultSpec =
  | { name: "force_curation_timeout" }
  | { name: "force_curation_invalid" }
  | { name: "kill_next_hydration"; n: number }
  | { name: "fail_one_lane" };

type StoredFault =
  | { kind: "force_curation_timeout" }
  | { kind: "force_curation_invalid" }
  | { kind: "kill_next_hydration"; remaining: number }
  | { kind: "fail_one_lane"; fired: boolean };

const faultsByConversation = new Map<string, StoredFault[]>();

function normalizeSpec(spec: QaFaultSpec): StoredFault {
  switch (spec.name) {
    case "force_curation_timeout":
      return { kind: "force_curation_timeout" };
    case "force_curation_invalid":
      return { kind: "force_curation_invalid" };
    case "kill_next_hydration":
      return { kind: "kill_next_hydration", remaining: Math.max(1, spec.n) };
    case "fail_one_lane":
      return { kind: "fail_one_lane", fired: false };
    default:
      return { kind: "force_curation_timeout" };
  }
}

export function parseQaFaultHeader(raw: string | null): QaFaultSpec[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: QaFaultSpec[] = [];
    for (const row of parsed) {
      if (typeof row === "string") {
        if (
          row === "force_curation_timeout" ||
          row === "force_curation_invalid" ||
          row === "fail_one_lane"
        ) {
          out.push({ name: row });
        }
        continue;
      }
      if (!row || typeof row !== "object") continue;
      const name = (row as { name?: string }).name;
      if (name === "kill_next_hydration") {
        const n = Number((row as { n?: number }).n ?? 1);
        out.push({ name: "kill_next_hydration", n });
      } else if (
        name === "force_curation_timeout" ||
        name === "force_curation_invalid" ||
        name === "fail_one_lane"
      ) {
        out.push({ name });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function setQaFaultsForConversation(
  conversationId: string,
  specs: QaFaultSpec[],
): void {
  if (!isQaDevEnvironment()) return;
  faultsByConversation.set(
    conversationId,
    specs.map((s) => normalizeSpec(s)),
  );
}

export function mergeQaFaultsForConversation(
  conversationId: string,
  specs: QaFaultSpec[],
): void {
  if (!isQaDevEnvironment() || !specs.length) return;
  const existing = faultsByConversation.get(conversationId) ?? [];
  faultsByConversation.set(conversationId, [
    ...existing,
    ...specs.map((s) => normalizeSpec(s)),
  ]);
}

export function clearQaFaultsForConversation(conversationId: string): void {
  faultsByConversation.delete(conversationId);
}

export function listQaFaultsForConversation(
  conversationId: string,
): QaFaultSpec[] {
  const stored = faultsByConversation.get(conversationId) ?? [];
  return stored.map((f) => {
    switch (f.kind) {
      case "kill_next_hydration":
        return { name: "kill_next_hydration", n: f.remaining };
      default:
        return { name: f.kind };
    }
  });
}

function logFaultFired(params: {
  conversationId: string;
  fault: QaFaultName;
  traceId?: string | null;
  detail?: Record<string, unknown>;
}): void {
  recordPipelineEvent({
    traceId: params.traceId,
    stage: "qa_fault_fired",
    payload: {
      conversation_id: params.conversationId,
      fault: params.fault,
      ...params.detail,
    },
  });
}

function removeFault(
  conversationId: string,
  predicate: (f: StoredFault) => boolean,
): void {
  const list = faultsByConversation.get(conversationId);
  if (!list?.length) return;
  const next = list.filter((f) => !predicate(f));
  if (next.length) faultsByConversation.set(conversationId, next);
  else faultsByConversation.delete(conversationId);
}

export function consumeQaFault(
  conversationId: string | null | undefined,
  fault: QaFaultName,
  traceId?: string | null,
  detail?: Record<string, unknown>,
): boolean {
  const convId = conversationId ?? activeQaConversationId();
  if (!convId || !isQaDevEnvironment()) return false;
  const list = faultsByConversation.get(convId);
  if (!list?.length) return false;

  const idx = list.findIndex((f) => {
    if (fault === "kill_next_hydration") return f.kind === "kill_next_hydration";
    return f.kind === fault;
  });
  if (idx < 0) return false;

  const entry = list[idx]!;
  logFaultFired({ conversationId: convId, fault, traceId, detail });

  if (entry.kind === "kill_next_hydration") {
    entry.remaining -= 1;
    if (entry.remaining <= 0) list.splice(idx, 1);
    if (!list.length) faultsByConversation.delete(convId);
    return true;
  }

  if (entry.kind === "fail_one_lane") {
    if (entry.fired) return false;
    entry.fired = true;
    removeFault(convId, (f) => f.kind === "fail_one_lane" && f.fired);
    return true;
  }

  list.splice(idx, 1);
  if (!list.length) faultsByConversation.delete(convId);
  return true;
}

export function hasQaFault(
  conversationId: string | null | undefined,
  fault: QaFaultName,
): boolean {
  const convId = conversationId ?? activeQaConversationId();
  if (!convId || !isQaDevEnvironment()) return false;
  const list = faultsByConversation.get(convId);
  if (!list?.length) return false;
  if (fault === "kill_next_hydration") {
    return list.some((f) => f.kind === "kill_next_hydration" && f.remaining > 0);
  }
  if (fault === "fail_one_lane") {
    return list.some((f) => f.kind === "fail_one_lane" && !f.fired);
  }
  return list.some((f) => f.kind === fault);
}
