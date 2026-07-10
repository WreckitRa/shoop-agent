import { fashionMemoryDb } from "./db";
import type { ExtractionRunRow } from "./types";

const RUNNING_LOCK_MS = 60_000;

export async function getDoneExtractionWatermark(params: {
  userId: string;
  conversationId: string;
}): Promise<string | null> {
  const db = fashionMemoryDb();
  const row = await db
    .from("extraction_runs")
    .select("last_message_id")
    .eq("user_id", params.userId)
    .eq("conversation_id", params.conversationId)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (row.error) throw new Error(row.error.message);
  return (row.data as { last_message_id: string } | null)?.last_message_id ?? null;
}

export async function hasRecentRunningExtraction(params: {
  userId: string;
  conversationId: string;
  maxAgeMs?: number;
}): Promise<boolean> {
  const db = fashionMemoryDb();
  const cutoff = new Date(
    Date.now() - (params.maxAgeMs ?? RUNNING_LOCK_MS),
  ).toISOString();
  const row = await db
    .from("extraction_runs")
    .select("id")
    .eq("user_id", params.userId)
    .eq("conversation_id", params.conversationId)
    .eq("status", "running")
    .gte("created_at", cutoff)
    .limit(1)
    .maybeSingle();
  if (row.error) throw new Error(row.error.message);
  return Boolean(row.data);
}

export async function beginExtractionRun(params: {
  userId: string;
  conversationId: string;
  lastMessageId: string;
}): Promise<ExtractionRunRow> {
  const db = fashionMemoryDb();
  const row = await db
    .from("extraction_runs")
    .insert({
      user_id: params.userId,
      conversation_id: params.conversationId,
      last_message_id: params.lastMessageId,
      status: "running",
    } as never)
    .select("*")
    .single();
  if (row.error || !row.data) {
    throw new Error(row.error?.message ?? "beginExtractionRun failed");
  }
  return row.data as ExtractionRunRow;
}

export async function   finishExtractionRun(params: {
  userId: string;
  runId: string;
  status: "done" | "failed";
  opsApplied?: import("./types").ExtractionOpResult[];
  ambiguousSubjects?: import("./types").AmbiguousSubject[] | null;
}): Promise<void> {
  const db = fashionMemoryDb();
  const { error } = await db
    .from("extraction_runs")
    .update({
      status: params.status,
      ops_applied: params.opsApplied ?? null,
      ambiguous_subjects: params.ambiguousSubjects ?? null,
      finished_at: new Date().toISOString(),
    } as never)
    .eq("id", params.runId)
    .eq("user_id", params.userId);
  if (error) throw new Error(error.message);
}

export async function getLatestDoneExtractionRun(params: {
  userId: string;
  conversationId: string;
}): Promise<ExtractionRunRow | null> {
  const db = fashionMemoryDb();
  const row = await db
    .from("extraction_runs")
    .select("*")
    .eq("user_id", params.userId)
    .eq("conversation_id", params.conversationId)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (row.error) throw new Error(row.error.message);
  return (row.data as ExtractionRunRow | null) ?? null;
}
