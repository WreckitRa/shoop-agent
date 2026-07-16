"use client";

import { create } from "zustand";
import type { RenderPickBadge } from "@/lib/fashion-memory/types/render-contract";
import type { TryonCompareVariant } from "@/lib/tryon/types";
import { isCompareSettled } from "@/lib/tryon/compare-variants";
import {
  TRYON_CLIENT_POLL_MAX_MS,
  TRYON_CLIENT_POLL_MS,
} from "@/lib/tryon/client-poll";
import { useChatStore } from "@/components/chat/chat-store";
import { useCartStore } from "@/components/cart/cart-store";

export type TryOnDrawerItem = {
  ref: string;
  title: string;
  imageUrl?: string;
  price?: { amount: number; currency: string };
  productId?: string;
  preferredOptions?: Array<{ name: string; label: string }>;
  featuredVariant?: {
    id: string;
    price?: { amount: number; currency: string };
    checkoutUrl?: string;
    options?: Array<{ name: string; label: string }>;
  };
};

export type TryOnDrawerSession = {
  kind: "item" | "look";
  searchId: string;
  /** Pick ref for single-item try-on. */
  ref?: string;
  /** Look id / name for outfit try-on. */
  lookId?: string;
  title: string;
  items: TryOnDrawerItem[];
  badgesByRef?: Record<string, RenderPickBadge[]>;
};

type LookStep = {
  ref: string;
  title?: string;
  status: string;
  image_url?: string;
};

type TryOnDrawerStatus =
  | "idle"
  | "loading_avatar"
  | "starting"
  | "processing"
  | "completed"
  | "failed";

type TryOnDrawerState = {
  open: boolean;
  session: TryOnDrawerSession | null;
  avatarUrl: string | null;
  status: TryOnDrawerStatus;
  jobId: string | null;
  resultUrl: string | null;
  error: string | null;
  compare: boolean;
  variants: TryonCompareVariant[];
  lookSteps: LookStep[];
  partialNote: string | null;
  /** Generation token — stale polls ignore after a new open. */
  generation: number;

  openItemTryOn: (params: {
    searchId: string;
    ref: string;
    title: string;
    imageUrl?: string;
    price?: { amount: number; currency: string };
    productId?: string;
    preferredOptions?: Array<{ name: string; label: string }>;
    featuredVariant?: TryOnDrawerItem["featuredVariant"];
    badges?: RenderPickBadge[];
  }) => void;
  openLookTryOn: (params: {
    searchId: string;
    lookId: string;
    title: string;
    items: TryOnDrawerItem[];
  }) => void;
  /** Reopen drawer on avatar + last try-on without starting a new job. */
  openAvatarViewer: () => Promise<void>;
  close: () => void;
  sendFeedback: (rating: 1 | -1, generationId?: string) => void;
};

function syncChromeForTryOnDrawer(open: boolean) {
  if (!open) return;
  const chat = useChatStore.getState();
  chat.setSidebarOpen(false);
  chat.setSidebarCollapsed(true);
  useCartStore.getState().setDrawerOpen(false);
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;

function clearPollTimer() {
  if (pollTimer != null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

async function fetchSelfAvatarUrl(): Promise<string | null> {
  try {
    const res = await fetch("/api/avatar/people", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      people?: Array<{
        relation: string;
        has_avatar: boolean;
        avatar_url: string | null;
      }>;
    };
    const self =
      body.people?.find((p) => p.relation === "self") ?? body.people?.[0];
    return self?.avatar_url ?? null;
  } catch {
    return null;
  }
}

function schedulePoll(
  generation: number,
  kind: "item" | "look",
  jobId: string,
  startedAt: number,
) {
  clearPollTimer();
  pollTimer = setTimeout(() => {
    void pollOnce(generation, kind, jobId, startedAt);
  }, TRYON_CLIENT_POLL_MS);
}

async function pollOnce(
  generation: number,
  kind: "item" | "look",
  jobId: string,
  startedAt: number,
) {
  const state = useTryOnDrawerStore.getState();
  if (!state.open || state.generation !== generation) return;

  if (Date.now() - startedAt > TRYON_CLIENT_POLL_MAX_MS) {
    useTryOnDrawerStore.setState({
      status: "failed",
      error:
        kind === "look"
          ? "Still dressing in the background — open try-on again in a moment."
          : "Still dressing in the background — tap try-on again in a moment.",
    });
    return;
  }

  try {
    if (kind === "item") {
      const res = await fetch(`/api/tryon/${jobId}`);
      const body = await res.json();
      if (useTryOnDrawerStore.getState().generation !== generation) return;
      applyItemPoll(generation, jobId, body, startedAt);
    } else {
      const res = await fetch(`/api/tryon/look/${jobId}`);
      const body = await res.json();
      if (useTryOnDrawerStore.getState().generation !== generation) return;
      if (!body.tryon_look) {
        useTryOnDrawerStore.setState({
          status: "failed",
          error: "Couldn't load try-on status — try again.",
        });
        return;
      }
      applyLookPoll(generation, jobId, body.tryon_look, startedAt);
    }
  } catch {
    if (useTryOnDrawerStore.getState().generation !== generation) return;
    schedulePoll(generation, kind, jobId, startedAt);
  }
}

function applyItemPoll(
  generation: number,
  jobId: string,
  body: {
    status: string;
    imageUrl?: string;
    compare?: boolean;
    variants?: TryonCompareVariant[];
    error?: string;
  },
  startedAt: number,
) {
  if (body.compare) {
    const variants = body.variants ?? [];
    const first = variants.find((v) => v.image_url);
    useTryOnDrawerStore.setState({
      compare: true,
      variants,
      resultUrl: first?.image_url ?? null,
      status: isCompareSettled(variants)
        ? variants.some((v) => v.image_url)
          ? "completed"
          : body.status === "failed"
            ? "failed"
            : "processing"
        : "processing",
      error:
        body.status === "failed" && !variants.some((v) => v.image_url)
          ? (body.error ?? "Couldn't dress this one — try another piece.")
          : null,
    });
    if (!isCompareSettled(variants) && body.status !== "failed") {
      schedulePoll(generation, "item", jobId, startedAt);
    }
    return;
  }

  if (body.status === "completed" && body.imageUrl) {
    useTryOnDrawerStore.setState({
      status: "completed",
      resultUrl: body.imageUrl,
      error: null,
    });
    return;
  }
  if (body.status === "failed") {
    useTryOnDrawerStore.setState({
      status: "failed",
      error: body.error ?? "Couldn't dress this one — try another piece.",
    });
    return;
  }
  useTryOnDrawerStore.setState({ status: "processing" });
  schedulePoll(generation, "item", jobId, startedAt);
}

function applyLookPoll(
  generation: number,
  jobId: string,
  body: {
    status: string;
    compare?: boolean;
    variants?: TryonCompareVariant[];
    final_image_url?: string;
    partial_note?: string;
    steps?: LookStep[];
  },
  startedAt: number,
) {
  if (body.compare) {
    const variants = body.variants ?? [];
    const first = variants.find((v) => v.image_url);
    useTryOnDrawerStore.setState({
      compare: true,
      variants,
      lookSteps: body.steps ?? [],
      resultUrl: first?.image_url ?? body.final_image_url ?? null,
      partialNote: body.partial_note ?? null,
      status: isCompareSettled(variants)
        ? variants.some((v) => v.image_url)
          ? "completed"
          : body.status === "failed"
            ? "failed"
            : "processing"
        : "processing",
      error:
        body.status === "failed" && !variants.some((v) => v.image_url)
          ? (body.partial_note ??
            "Couldn't dress this look — try another combination.")
          : null,
    });
    if (!isCompareSettled(variants) && body.status !== "failed") {
      schedulePoll(generation, "look", jobId, startedAt);
    }
    return;
  }

  useTryOnDrawerStore.setState({
    lookSteps: body.steps ?? [],
    resultUrl: body.final_image_url ?? null,
    partialNote: body.partial_note ?? null,
  });

  if (body.status === "completed") {
    if (!body.final_image_url) {
      useTryOnDrawerStore.setState({
        status: "failed",
        error: "Couldn't dress this look — try another combination.",
      });
      return;
    }
    useTryOnDrawerStore.setState({
      status: "completed",
      resultUrl: body.final_image_url,
      error: null,
    });
    return;
  }
  if (body.status === "failed") {
    useTryOnDrawerStore.setState({
      status: "failed",
      error:
        body.partial_note ??
        "Couldn't dress this look — try another combination.",
    });
    return;
  }
  useTryOnDrawerStore.setState({ status: "processing" });
  schedulePoll(generation, "look", jobId, startedAt);
}

async function startItemJob(generation: number, session: TryOnDrawerSession) {
  useTryOnDrawerStore.setState({ status: "starting", error: null });
  try {
    const res = await fetch("/api/tryon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        search_id: session.searchId,
        ref: session.ref,
      }),
    });
    const body = await res.json();
    if (useTryOnDrawerStore.getState().generation !== generation) return;
    if (!res.ok) {
      useTryOnDrawerStore.setState({
        status: "failed",
        error: body.error ?? "Couldn't dress this one — try another piece.",
      });
      return;
    }
    useTryOnDrawerStore.setState({
      jobId: body.jobId,
      compare: Boolean(body.compare),
      variants: body.variants ?? [],
      status: "processing",
    });
    if (body.imageUrl) {
      applyItemPoll(generation, body.jobId, body, Date.now());
      return;
    }
    void pollOnce(generation, "item", body.jobId, Date.now());
  } catch {
    if (useTryOnDrawerStore.getState().generation !== generation) return;
    useTryOnDrawerStore.setState({
      status: "failed",
      error: "Couldn't dress this one — try another piece.",
    });
  }
}

async function startLookJob(generation: number, session: TryOnDrawerSession) {
  useTryOnDrawerStore.setState({ status: "starting", error: null });
  try {
    const res = await fetch("/api/tryon/look", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        search_id: session.searchId,
        look_id: session.lookId,
      }),
    });
    const body = await res.json();
    if (useTryOnDrawerStore.getState().generation !== generation) return;
    if (!res.ok) {
      useTryOnDrawerStore.setState({
        status: "failed",
        error: body.error ?? "Couldn't dress this look — try again.",
      });
      return;
    }
    useTryOnDrawerStore.setState({
      jobId: body.jobId,
      compare: Boolean(body.compare),
      variants: body.variants ?? [],
      status: "processing",
    });
    if (
      body.compare &&
      body.variants?.some((v: TryonCompareVariant) => v.image_url)
    ) {
      applyLookPoll(
        generation,
        body.jobId,
        {
          status: "completed",
          compare: true,
          variants: body.variants,
          final_image_url: body.variants.find(
            (v: TryonCompareVariant) => v.image_url,
          )?.image_url,
        },
        Date.now(),
      );
      return;
    }
    void pollOnce(generation, "look", body.jobId, Date.now());
  } catch {
    if (useTryOnDrawerStore.getState().generation !== generation) return;
    useTryOnDrawerStore.setState({
      status: "failed",
      error: "Couldn't dress this look — try again.",
    });
  }
}

async function bootstrapSession(
  generation: number,
  session: TryOnDrawerSession,
) {
  useTryOnDrawerStore.setState({ status: "loading_avatar" });
  const avatarUrl = await fetchSelfAvatarUrl();
  if (useTryOnDrawerStore.getState().generation !== generation) return;
  useTryOnDrawerStore.setState({ avatarUrl });

  if (session.kind === "item") {
    await startItemJob(generation, session);
  } else {
    await startLookJob(generation, session);
  }
}

export const useTryOnDrawerStore = create<TryOnDrawerState>((set, get) => ({
  open: false,
  session: null,
  avatarUrl: null,
  status: "idle",
  jobId: null,
  resultUrl: null,
  error: null,
  compare: false,
  variants: [],
  lookSteps: [],
  partialNote: null,
  generation: 0,

  openItemTryOn: (params) => {
    clearPollTimer();
    const generation = get().generation + 1;
    const session: TryOnDrawerSession = {
      kind: "item",
      searchId: params.searchId,
      ref: params.ref,
      title: params.title,
      items: [
        {
          ref: params.ref,
          title: params.title,
          imageUrl: params.imageUrl,
          price: params.price,
          productId: params.productId,
          preferredOptions: params.preferredOptions,
          featuredVariant: params.featuredVariant,
        },
      ],
      badgesByRef: params.badges
        ? { [params.ref]: params.badges }
        : undefined,
    };
    syncChromeForTryOnDrawer(true);
    set({
      open: true,
      session,
      generation,
      avatarUrl: null,
      status: "loading_avatar",
      jobId: null,
      resultUrl: null,
      error: null,
      compare: false,
      variants: [],
      lookSteps: [],
      partialNote: null,
    });
    void bootstrapSession(generation, session);
  },

  openLookTryOn: (params) => {
    clearPollTimer();
    const generation = get().generation + 1;
    const session: TryOnDrawerSession = {
      kind: "look",
      searchId: params.searchId,
      lookId: params.lookId,
      title: params.title,
      items: params.items,
    };
    syncChromeForTryOnDrawer(true);
    set({
      open: true,
      session,
      generation,
      avatarUrl: null,
      status: "loading_avatar",
      jobId: null,
      resultUrl: null,
      error: null,
      compare: false,
      variants: [],
      lookSteps: [],
      partialNote: null,
    });
    void bootstrapSession(generation, session);
  },

  openAvatarViewer: async () => {
    const current = get();
    if (current.open) {
      get().close();
      return;
    }

    // In-session result still held after close — reopen instantly.
    if (current.resultUrl) {
      clearPollTimer();
      syncChromeForTryOnDrawer(true);
      set({
        open: true,
        status: "completed",
        error: null,
        session: current.session ?? {
          kind: "item",
          searchId: current.jobId ?? "last",
          title: "Your last try-on",
          items: [],
        },
      });
      return;
    }

    clearPollTimer();
    const generation = get().generation + 1;
    syncChromeForTryOnDrawer(true);
    set({
      open: true,
      generation,
      status: "loading_avatar",
      error: null,
      compare: false,
      variants: [],
      lookSteps: [],
      partialNote: null,
    });

    try {
      const res = await fetch("/api/tryon/latest", { cache: "no-store" });
      if (get().generation !== generation) return;

      if (res.status === 401) {
        set({ open: false, status: "idle" });
        const { useSelfAvatarStore } = await import(
          "@/components/tryon/self-avatar-store"
        );
        useSelfAvatarStore.getState().openCreateFlow();
        return;
      }

      if (!res.ok) {
        set({
          status: "failed",
          error: "Couldn't load your avatar — try again.",
        });
        return;
      }

      const body = (await res.json()) as {
        avatar_url?: string | null;
        has_avatar?: boolean;
        tryon?: {
          job_id: string;
          image_url: string;
          kind: "item" | "look" | null;
          search_id: string | null;
          ref: string | null;
          look_id: string | null;
          title: string;
        } | null;
      };

      if (!body.has_avatar) {
        set({ open: false, status: "idle", avatarUrl: null });
        const { useSelfAvatarStore } = await import(
          "@/components/tryon/self-avatar-store"
        );
        useSelfAvatarStore.getState().openCreateFlow();
        return;
      }

      const tryon = body.tryon;
      if (tryon?.image_url) {
        const kind = tryon.kind === "look" ? "look" : "item";
        set({
          avatarUrl: body.avatar_url ?? null,
          resultUrl: tryon.image_url,
          jobId: tryon.job_id,
          status: "completed",
          error: null,
          session: {
            kind,
            searchId: tryon.search_id ?? tryon.job_id,
            ref: tryon.ref ?? undefined,
            lookId: tryon.look_id ?? undefined,
            title: tryon.title,
            items: [],
          },
        });
        return;
      }

      set({
        avatarUrl: body.avatar_url ?? null,
        resultUrl: null,
        jobId: null,
        status: "idle",
        error: null,
        session: {
          kind: "item",
          searchId: "avatar",
          title: "Your avatar",
          items: [],
        },
      });
    } catch {
      if (get().generation !== generation) return;
      set({
        status: "failed",
        error: "Couldn't load your avatar — try again.",
      });
    }
  },

  close: () => {
    clearPollTimer();
    set({
      open: false,
      generation: get().generation + 1,
      status: "idle",
    });
  },

  sendFeedback: (rating, generationId) => {
    const id = generationId ?? get().jobId;
    if (!id) return;
    void fetch("/api/tryon/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation_id: id, rating }),
    });
  },
}));
