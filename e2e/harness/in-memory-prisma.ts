/**
 * Minimal in-memory Prisma for fashion E2E — conversation, message, branch, userProfile.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { setPrismaClientOverride } from "@/lib/ai-chat/db";

export type MemoryMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "completed" | "streaming" | "failed" | "stopped";
  model: string | null;
  metadata: unknown;
  branchId: string | null;
  createdAt: Date;
  updatedAt: Date;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
  error: string | null;
};

export type MemoryConversation = {
  id: string;
  title: string;
  userId: string;
  model: string;
  temperature: number;
  maxTokens: number;
  responseStyle: "balanced";
  systemPrompt: string | null;
  shippingCountry: string | null;
  currency: string | null;
  archived: boolean;
  deletedAt: Date | null;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type MemoryBranch = {
  id: string;
  conversationId: string;
  index: number;
  title: string;
  anchorMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type InMemoryPrismaStore = {
  conversations: Map<string, MemoryConversation>;
  messages: Map<string, MemoryMessage>;
  branches: Map<string, MemoryBranch>;
};

function orderMessages(rows: MemoryMessage[]) {
  return [...rows].sort((a, b) => {
    const t = a.createdAt.getTime() - b.createdAt.getTime();
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
}

function matchWhere<T extends Record<string, unknown>>(
  row: T,
  where: Record<string, unknown> | undefined,
): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "id" && typeof v === "object" && v && "in" in (v as object)) {
      const ids = (v as { in: string[] }).in;
      if (!ids.includes(String(row.id))) return false;
      continue;
    }
    if (k === "branchId" && v === null) {
      if (row.branchId != null) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

export function createInMemoryPrismaStore(): InMemoryPrismaStore {
  return {
    conversations: new Map(),
    messages: new Map(),
    branches: new Map(),
  };
}

export function installInMemoryPrisma(
  store: InMemoryPrismaStore,
  defaults?: { userId?: string },
): void {
  const defaultUserId = defaults?.userId ?? "guest-e2e-00000000-0000-4000-8000-000000000001";

  const conversation = {
    async findFirst(args?: { where?: Record<string, unknown> }) {
      for (const row of store.conversations.values()) {
        if (matchWhere(row, args?.where)) return { ...row };
      }
      return null;
    },
    async findUnique(args: { where: { id: string } }) {
      const row = store.conversations.get(args.where.id);
      return row ? { ...row } : null;
    },
    async create(args: { data: Partial<MemoryConversation> & { userId?: string } }) {
      const id = args.data.id ?? `conv_${randomUUID().slice(0, 12)}`;
      const now = new Date();
      const row: MemoryConversation = {
        id,
        title: args.data.title ?? "New chat",
        userId: args.data.userId ?? defaultUserId,
        model: args.data.model ?? "claude-sonnet-4-20250514",
        temperature: args.data.temperature ?? 0.7,
        maxTokens: args.data.maxTokens ?? 4096,
        responseStyle: "balanced",
        systemPrompt: args.data.systemPrompt ?? null,
        shippingCountry: args.data.shippingCountry ?? "US",
        currency: args.data.currency ?? "USD",
        archived: false,
        deletedAt: null,
        pinned: false,
        createdAt: now,
        updatedAt: now,
      };
      store.conversations.set(id, row);
      return { ...row };
    },
    async update(args: { where: { id: string }; data: Partial<MemoryConversation> }) {
      const row = store.conversations.get(args.where.id);
      if (!row) throw new Error("Conversation not found");
      Object.assign(row, args.data, { updatedAt: new Date() });
      return { ...row };
    },
  };

  const message = {
    async findFirst(args?: {
      where?: Record<string, unknown>;
      orderBy?: Array<Record<string, "asc" | "desc">>;
      select?: Record<string, boolean>;
    }) {
      let rows = [...store.messages.values()].filter((r) =>
        matchWhere(r, args?.where),
      );
      rows = orderMessages(rows);
      if (args?.orderBy?.[0]?.createdAt === "desc") rows.reverse();
      const hit = rows[0];
      if (!hit) return null;
      return projectSelect(hit, args?.select);
    },
    async findMany(args?: {
      where?: Record<string, unknown>;
      orderBy?: Array<Record<string, "asc" | "desc">>;
      take?: number;
      select?: Record<string, boolean>;
    }) {
      let rows = [...store.messages.values()].filter((r) =>
        matchWhere(r, args?.where),
      );
      rows = orderMessages(rows);
      if (args?.orderBy?.[0]?.createdAt === "desc") rows.reverse();
      if (args?.take != null) rows = rows.slice(0, args.take);
      return rows.map((r) => projectSelect(r, args?.select));
    },
    async findUnique(args: { where: { id: string }; select?: Record<string, boolean> }) {
      const row = store.messages.get(args.where.id);
      if (!row) return null;
      return projectSelect(row, args?.select);
    },
    async create(args: { data: Partial<MemoryMessage> & { conversationId: string; role: MemoryMessage["role"]; content: string } }) {
      const id = args.data.id ?? `msg_${randomUUID().slice(0, 12)}`;
      const now = new Date();
      const row: MemoryMessage = {
        id,
        conversationId: args.data.conversationId,
        role: args.data.role,
        content: args.data.content,
        status: (args.data.status as MemoryMessage["status"]) ?? "completed",
        model: args.data.model ?? null,
        metadata: args.data.metadata ?? null,
        branchId: args.data.branchId ?? null,
        createdAt: now,
        updatedAt: now,
        inputTokens: null,
        outputTokens: null,
        finishReason: null,
        error: null,
      };
      store.messages.set(id, row);
      return { ...row };
    },
    async update(args: {
      where: { id: string };
      data: Partial<MemoryMessage>;
      select?: Record<string, boolean>;
    }) {
      const row = store.messages.get(args.where.id);
      if (!row) throw new Error("Message not found");
      Object.assign(row, args.data, { updatedAt: new Date() });
      return projectSelect(row, args?.select);
    },
    async updateMany(args: {
      where: Record<string, unknown>;
      data: Partial<MemoryMessage>;
    }) {
      let count = 0;
      for (const row of store.messages.values()) {
        if (!matchWhere(row, args.where)) continue;
        Object.assign(row, args.data, { updatedAt: new Date() });
        count += 1;
      }
      return { count };
    },
    async deleteMany(args?: { where?: { id?: { in: string[] } } }) {
      const ids = args?.where?.id?.in ?? [];
      let count = 0;
      for (const id of ids) {
        if (store.messages.delete(id)) count += 1;
      }
      return { count };
    },
  };

  const conversationBranch = {
    async findFirst(args?: {
      where?: Record<string, unknown>;
      orderBy?: { index?: "asc" | "desc" };
      select?: Record<string, boolean>;
    }) {
      let rows = [...store.branches.values()].filter((r) =>
        matchWhere(r, args?.where),
      );
      rows.sort((a, b) => a.index - b.index);
      if (args?.orderBy?.index === "desc") rows.reverse();
      const hit = rows[0];
      if (!hit) return null;
      return projectSelect(hit, args?.select);
    },
    async create(args: {
      data: {
        conversationId: string;
        index: number;
        title: string;
        anchorMessageId?: string | null;
      };
    }) {
      const id = `branch_${randomUUID().slice(0, 8)}`;
      const now = new Date();
      const row: MemoryBranch = {
        id,
        conversationId: args.data.conversationId,
        index: args.data.index,
        title: args.data.title,
        anchorMessageId: args.data.anchorMessageId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      store.branches.set(id, row);
      return { ...row };
    },
    async update(args: { where: { id: string }; data: Partial<MemoryBranch> }) {
      const row = store.branches.get(args.where.id);
      if (!row) throw new Error("Branch not found");
      Object.assign(row, args.data, { updatedAt: new Date() });
      return { ...row };
    },
    async updateMany(args: {
      where: Record<string, unknown>;
      data: Partial<MemoryBranch>;
    }) {
      let count = 0;
      for (const row of store.branches.values()) {
        if (!matchWhere(row, args.where)) continue;
        Object.assign(row, args.data, { updatedAt: new Date() });
        count += 1;
      }
      return { count };
    },
  };

  const userProfile = {
    async findUnique() {
      return {
        userId: defaultUserId,
        shippingCountry: "US",
        country: "US",
        currency: "USD",
      };
    },
  };

  const client = {
    conversation,
    message,
    conversationBranch,
    userProfile,
    $connect: async () => {},
    $disconnect: async () => {},
  };

  setPrismaClientOverride(client as unknown as PrismaClient);
}

export function uninstallInMemoryPrisma(): void {
  setPrismaClientOverride(null);
}

function projectSelect<T extends Record<string, unknown>>(
  row: T,
  select?: Record<string, boolean>,
): T | Partial<T> {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    if (select[key]) out[key] = row[key];
  }
  return out as Partial<T>;
}
