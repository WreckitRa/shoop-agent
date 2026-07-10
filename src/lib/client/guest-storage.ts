import type {
  ChatMessage,
  ConversationBranchSummary,
  ConversationSummary,
} from "@/lib/ai-chat/types";
import type { GuestFashionMemorySnapshot } from "@/lib/fashion-memory/local/store";
import { DEFAULT_UI_SETTINGS } from "@/lib/ai-chat/constants";
import { isValidGuestSessionToken } from "@/lib/auth/guest-session";

export const GUEST_STORAGE_VERSION = 1 as const;
export const GUEST_SESSION_KEY = "shoop.guest.session";
export const GUEST_DATA_KEY = "shoop.guest.data";

export type GuestMemorySnapshot = {
  preferredName?: string | null;
  styleLikes?: string[];
  styleAvoids?: string[];
  brandLikes?: string[];
  brandAvoids?: string[];
  notes?: string[];
  updatedAt: string;
};

/** Local guest payload — mirrors DB DTO shapes for seamless migration. */
export type GuestLocalData = {
  version: typeof GUEST_STORAGE_VERSION;
  guestId: string;
  createdAt: string;
  updatedAt: string;
  conversations: ConversationSummary[];
  branchesByConversationId?: Record<string, ConversationBranchSummary[]>;
  messagesByConversationId: Record<string, ChatMessage[]>;
  memory?: GuestMemorySnapshot;
  /** Fashion-only memory path (local until login). */
  fashionMemory?: GuestFashionMemorySnapshot;
};

export type GuestSessionMeta = {
  guestId: string;
  createdAt: string;
};

function emptyGuestData(guestId: string, createdAt: string): GuestLocalData {
  return {
    version: GUEST_STORAGE_VERSION,
    guestId,
    createdAt,
    updatedAt: createdAt,
    conversations: [],
    branchesByConversationId: {},
    messagesByConversationId: {},
  };
}

function readSessionMeta(): GuestSessionMeta | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(GUEST_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GuestSessionMeta;
    if (!parsed?.guestId || !isValidGuestSessionToken(parsed.guestId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionMeta(meta: GuestSessionMeta) {
  localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(meta));
}

export function loadGuestData(): GuestLocalData | null {
  if (typeof window === "undefined") return null;
  const session = readSessionMeta();
  if (!session) return null;
  try {
    const raw = localStorage.getItem(GUEST_DATA_KEY);
    if (!raw) return emptyGuestData(session.guestId, session.createdAt);
    const parsed = JSON.parse(raw) as GuestLocalData;
    if (parsed.version !== GUEST_STORAGE_VERSION) return null;
    if (parsed.guestId !== session.guestId) return null;
    return parsed;
  } catch {
    return emptyGuestData(session.guestId, session.createdAt);
  }
}

export function saveGuestData(data: GuestLocalData) {
  if (typeof window === "undefined") return;
  const next: GuestLocalData = {
    ...data,
    version: GUEST_STORAGE_VERSION,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(GUEST_DATA_KEY, JSON.stringify(next));
}

export function isGuestSessionActive(): boolean {
  return readSessionMeta() !== null;
}

export function getGuestSessionId(): string | null {
  return readSessionMeta()?.guestId ?? null;
}

/**
 * Start a new guest session by requesting a server-signed token.
 * Falls back to a client-generated UUID if the network call fails, ensuring
 * guest mode works offline or when the endpoint is unavailable.
 */
export async function startGuestSessionAsync(): Promise<GuestSessionMeta> {
  const existing = readSessionMeta();
  if (existing) return existing;

  let guestId: string;
  try {
    const res = await fetch("/api/auth/guest", { method: "POST" });
    if (res.ok) {
      const body = (await res.json()) as { token?: string };
      guestId = body.token ?? crypto.randomUUID();
    } else {
      guestId = crypto.randomUUID();
    }
  } catch {
    guestId = crypto.randomUUID();
  }

  const createdAt = new Date().toISOString();
  const meta: GuestSessionMeta = { guestId, createdAt };
  writeSessionMeta(meta);
  saveGuestData(emptyGuestData(guestId, createdAt));
  window.dispatchEvent(new Event("shoop-guest-changed"));
  return meta;
}

/** Synchronous fallback — starts a session with a plain UUID if none exists. */
export function startGuestSession(): GuestSessionMeta {
  const existing = readSessionMeta();
  if (existing) return existing;

  const guestId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const meta: GuestSessionMeta = { guestId, createdAt };
  writeSessionMeta(meta);
  saveGuestData(emptyGuestData(guestId, createdAt));
  window.dispatchEvent(new Event("shoop-guest-changed"));
  return meta;
}

export function clearGuestSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(GUEST_SESSION_KEY);
  localStorage.removeItem(GUEST_DATA_KEY);
  window.dispatchEvent(new Event("shoop-guest-changed"));
}

export function exportGuestDataForMigration(): {
  guestId: string;
  data: GuestLocalData;
} | null {
  const session = readSessionMeta();
  const data = loadGuestData();
  if (!session || !data) return null;
  return { guestId: session.guestId, data };
}

function mergeGuestConversations(
  existing: ConversationSummary[],
  fromStore: ConversationSummary[],
): ConversationSummary[] {
  const storeById = new Map(fromStore.map((c) => [c.id, c]));
  const merged = existing.map((c) =>
    c.deletedAt ? c : (storeById.get(c.id) ?? c),
  );
  for (const c of fromStore) {
    if (!existing.some((e) => e.id === c.id)) merged.unshift(c);
  }
  return merged.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function syncGuestBranchesToLocal(
  branchesByConversationId: Record<string, ConversationBranchSummary[]>,
): void {
  const base = loadGuestData();
  if (!base) return;
  saveGuestData({
    ...base,
    branchesByConversationId: {
      ...(base.branchesByConversationId ?? {}),
      ...branchesByConversationId,
    },
  });
}

export function getGuestBranches(conversationId: string): ConversationBranchSummary[] {
  const base = loadGuestData();
  return base?.branchesByConversationId?.[conversationId] ?? [];
}

export function syncGuestChatFromStore(args: {
  conversations: ConversationSummary[];
  branchesByConversationId?: Record<string, ConversationBranchSummary[]>;
  messagesByConversationId: Record<string, ChatMessage[]>;
  activeConversationId?: string | null;
  activeMessages?: ChatMessage[];
}) {
  const base = loadGuestData();
  if (!base) return;

  const messagesByConversationId = { ...args.messagesByConversationId };
  if (args.activeConversationId && args.activeMessages) {
    messagesByConversationId[args.activeConversationId] = args.activeMessages;
  }

  saveGuestData({
    ...base,
    conversations: mergeGuestConversations(base.conversations, args.conversations),
    branchesByConversationId: {
      ...(base.branchesByConversationId ?? {}),
      ...(args.branchesByConversationId ?? {}),
    },
    messagesByConversationId,
  });
}

export function syncGuestConversationsToLocal(
  fromServer: ConversationSummary[],
): void {
  const base = loadGuestData();
  if (!base) return;
  const deleted = base.conversations.filter((c) => c.deletedAt);
  const serverIds = new Set(fromServer.map((c) => c.id));
  saveGuestData({
    ...base,
    conversations: [
      ...fromServer,
      ...deleted.filter((d) => !serverIds.has(d.id)),
    ],
  });
}

export function upsertGuestConversation(summary: ConversationSummary) {
  const base = loadGuestData();
  if (!base) return;
  const idx = base.conversations.findIndex((c) => c.id === summary.id);
  const conversations =
    idx === -1
      ? [summary, ...base.conversations]
      : base.conversations.map((c, i) => (i === idx ? summary : c));
  saveGuestData({ ...base, conversations });
}

export function softDeleteGuestConversation(id: string): boolean {
  const base = loadGuestData();
  if (!base) return false;
  const target = base.conversations.find((c) => c.id === id);
  if (!target || target.deletedAt) return false;

  const deletedAt = new Date().toISOString();
  const conversations = base.conversations.map((c) =>
    c.id === id ? { ...c, deletedAt } : c,
  );
  saveGuestData({ ...base, conversations });
  return true;
}

export function listVisibleGuestConversations(
  conversations: ConversationSummary[],
): ConversationSummary[] {
  return conversations.filter((c) => !c.deletedAt);
}

export function createGuestConversationPlaceholder(id: string): ConversationSummary {
  const now = new Date().toISOString();
  return {
    id,
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    archived: false,
    deletedAt: null,
    pinned: false,
    model: DEFAULT_UI_SETTINGS.model,
    responseStyle: DEFAULT_UI_SETTINGS.responseStyle,
    temperature: DEFAULT_UI_SETTINGS.temperature,
    maxTokens: DEFAULT_UI_SETTINGS.maxTokens,
    systemPrompt: DEFAULT_UI_SETTINGS.systemPrompt ?? null,
  };
}

export function guestHasPersistedData(): boolean {
  const data = loadGuestData();
  if (!data) return false;
  if (data.conversations.length > 0) return true;
  if (Object.values(data.messagesByConversationId).some((msgs) => msgs.length > 0)) {
    return true;
  }
  const fm = data.fashionMemory;
  if (!fm) return false;
  return (
    fm.people.length > 0 ||
    fm.fashion_facts.length > 0 ||
    fm.style_signals.length > 0 ||
    fm.request_events.length > 0
  );
}
