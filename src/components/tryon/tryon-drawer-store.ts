"use client";

import { create } from "zustand";
import type { FittingRoomItem } from "@/lib/tryon/fitting-room-types";
import { MAX_FITTING_ROOM_ITEMS } from "@/lib/tryon/fitting-room-types";
import type { TryonCompareVariant } from "@/lib/tryon/types";
import { isCompareSettled } from "@/lib/tryon/compare-variants";
import {
  TRYON_CLIENT_POLL_MAX_MS,
  TRYON_CLIENT_POLL_MS,
} from "@/lib/tryon/client-poll";
import { useChatStore } from "@/components/chat/chat-store";
import { useCartStore } from "@/components/cart/cart-store";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import {
  findActiveSlotConflict,
  fittingRoomGarmentType,
  slotGuardMessage,
} from "@/lib/tryon/fitting-room-slot-guard";

export type { FittingRoomItem };

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

type AddToFittingRoomResult = "added" | "duplicate" | "full";

type PollSource = "fitting-room" | "look";

type TryOnDrawerState = {
  open: boolean;
  itemsById: Record<string, FittingRoomItem>;
  rackIds: string[];
  activeIds: string[];
  avatarUrl: string | null;
  status: TryOnDrawerStatus;
  jobId: string | null;
  resultUrl: string | null;
  error: string | null;
  compare: boolean;
  variants: TryonCompareVariant[];
  lookSteps: LookStep[];
  partialNote: string | null;
  /** Generation token — stale polls ignore after a new render. */
  renderGeneration: number;
  /** Look id when a curated look preview job is running. */
  previewLookId: string | null;
  previewLookTitle: string | null;

  openFittingRoom: () => void;
  addToFittingRoom: (item: FittingRoomItem) => AddToFittingRoomResult;
  addManyToFittingRoom: (items: FittingRoomItem[]) => {
    added: number;
    skipped: number;
    full: boolean;
  };
  removeFromRack: (id: string) => void;
  tryOnItem: (id: string, opts?: { replaceSameType?: boolean }) => void;
  removeFromAvatar: (id: string) => void;
  openLookTryOn: (params: {
    searchId: string;
    lookId: string;
    title: string;
    /** Look pieces — seed the candidate rack when opening. */
    items?: FittingRoomItem[];
  }) => void;
  /**
   * Open the changing room with these pieces active and dress via fitting-room
   * (not /api/tryon/look — that only works for named curation looks).
   */
  openAndDressItems: (params: {
    items: FittingRoomItem[];
    title?: string;
  }) => void;
  openAvatarViewer: () => Promise<void>;
  close: () => void;
  sendFeedback: (rating: 1 | -1, generationId?: string) => void;

  isInRack: (id: string) => boolean;
  isActive: (id: string) => boolean;
  isRackFull: () => boolean;
  isActiveFull: () => boolean;
};

function syncChromeForTryOnDrawer(open: boolean) {
  if (!open) return;
  const chat = useChatStore.getState();
  chat.setSidebarOpen(false);
  chat.setSidebarCollapsed(true);
  useCartStore.getState().setDrawerOpen(false);
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollSource: PollSource = "fitting-room";

function clearPollTimer() {
  if (pollTimer != null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

async function fetchSelfAvatarUrl(): Promise<string | null> {
  try {
    // Prefer tryon/latest — same source the hanger button uses.
    const latestRes = await fetch("/api/tryon/latest", { cache: "no-store" });
    if (latestRes.ok) {
      const latest = (await latestRes.json()) as {
        avatar_url?: string | null;
        has_avatar?: boolean;
      };
      if (latest.avatar_url) return latest.avatar_url;
    }

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

function readWarmAvatarUrl(): string | null {
  const self = useSelfAvatarStore.getState();
  if (self.status === "ready" && self.avatarUrl) return self.avatarUrl;
  return null;
}

function ensureAvatarLoaded(generation: number) {
  const state = useTryOnDrawerStore.getState();
  if (state.avatarUrl) {
    if (state.status === "loading_avatar") {
      useTryOnDrawerStore.setState({ status: "idle", error: null });
    }
    return Promise.resolve(state.avatarUrl);
  }

  const warm = readWarmAvatarUrl();
  if (warm) {
    useTryOnDrawerStore.setState({
      avatarUrl: warm,
      status: "idle",
      error: null,
    });
    return Promise.resolve(warm);
  }

  useTryOnDrawerStore.setState({ status: "loading_avatar", error: null });
  return fetchSelfAvatarUrl().then((avatarUrl) => {
    if (useTryOnDrawerStore.getState().renderGeneration !== generation) {
      return avatarUrl;
    }
    const current = useTryOnDrawerStore.getState().avatarUrl;
    const nextUrl = current ?? avatarUrl ?? readWarmAvatarUrl();
    useTryOnDrawerStore.setState({
      avatarUrl: nextUrl,
      status: nextUrl ? "idle" : "failed",
      error: nextUrl ? null : "Couldn't load your avatar — try again.",
    });
    return nextUrl;
  });
}

function schedulePoll(
  generation: number,
  jobId: string,
  startedAt: number,
  source: PollSource = pollSource,
) {
  pollSource = source;
  clearPollTimer();
  pollTimer = setTimeout(() => {
    void pollOnce(generation, jobId, startedAt);
  }, TRYON_CLIENT_POLL_MS);
}

async function pollOnce(
  generation: number,
  jobId: string,
  startedAt: number,
  source: PollSource = pollSource,
) {
  pollSource = source;
  const state = useTryOnDrawerStore.getState();
  if (!state.open || state.renderGeneration !== generation) return;

  if (Date.now() - startedAt > TRYON_CLIENT_POLL_MAX_MS) {
    useTryOnDrawerStore.setState({
      status: "failed",
      error:
        "Still dressing in the background — open the fitting room again in a moment.",
    });
    return;
  }

  try {
    const pollPath =
      pollSource === "look"
        ? `/api/tryon/look/${jobId}`
        : `/api/tryon/fitting-room/${jobId}`;
    const res = await fetch(pollPath);
    const body = await res.json();
    if (useTryOnDrawerStore.getState().renderGeneration !== generation) return;
    if (!body.tryon_look) {
      useTryOnDrawerStore.setState({
        status: "failed",
        error: "Couldn't load try-on status — try again.",
      });
      return;
    }
    applyLookPoll(generation, jobId, body.tryon_look, startedAt);
  } catch {
    if (useTryOnDrawerStore.getState().renderGeneration !== generation) return;
    schedulePoll(generation, jobId, startedAt);
  }
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
            "Couldn't dress this outfit — try another combination.")
          : null,
    });
    if (!isCompareSettled(variants) && body.status !== "failed") {
      schedulePoll(generation, jobId, startedAt);
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
        error: "Couldn't dress this outfit — try another combination.",
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
        "Couldn't dress this outfit — try another combination.",
    });
    return;
  }
  useTryOnDrawerStore.setState({ status: "processing" });
  schedulePoll(generation, jobId, startedAt);
}

async function startActiveOutfitRender(generation: number) {
  const state = useTryOnDrawerStore.getState();
  const activeItems = state.activeIds
    .map((id) => state.itemsById[id])
    .filter(Boolean) as FittingRoomItem[];

  if (!activeItems.length) {
    useTryOnDrawerStore.setState({
      status: "idle",
      jobId: null,
      resultUrl: null,
      error: null,
      compare: false,
      variants: [],
      lookSteps: [],
      partialNote: null,
    });
    return;
  }

  const supported = activeItems.filter((item) => item.tryonSupported);
  if (!supported.length) {
    useTryOnDrawerStore.setState({
      status: "failed",
      error: "None of the active pieces support try-on.",
    });
    return;
  }

  useTryOnDrawerStore.setState({
    status: "starting",
    error: null,
    compare: false,
    variants: [],
    lookSteps: [],
    partialNote: null,
  });

  try {
    const res = await fetch("/api/tryon/fitting-room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: supported.map((item) => ({ provenance: item.provenance })),
      }),
    });
    const body = await res.json();
    if (useTryOnDrawerStore.getState().renderGeneration !== generation) return;

    if (!res.ok) {
      useTryOnDrawerStore.setState({
        status: "failed",
        error: body.error ?? "Couldn't dress this outfit — try again.",
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

    void pollOnce(generation, body.jobId, Date.now(), "fitting-room");
  } catch {
    if (useTryOnDrawerStore.getState().renderGeneration !== generation) return;
    useTryOnDrawerStore.setState({
      status: "failed",
      error: "Couldn't dress this outfit — try again.",
    });
  }
}

async function startLookTryonJob(
  generation: number,
  params: { searchId: string; lookId: string; title: string },
) {
  useTryOnDrawerStore.setState({
    status: "starting",
    error: null,
    compare: false,
    variants: [],
    lookSteps: [],
    partialNote: null,
    previewLookId: params.lookId,
    previewLookTitle: params.title,
  });

  try {
    const res = await fetch("/api/tryon/look", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        search_id: params.searchId,
        look_id: params.lookId,
      }),
    });
    const body = await res.json();
    if (useTryOnDrawerStore.getState().renderGeneration !== generation) return;

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

    void pollOnce(generation, body.jobId, Date.now(), "look");
  } catch {
    if (useTryOnDrawerStore.getState().renderGeneration !== generation) return;
    useTryOnDrawerStore.setState({
      status: "failed",
      error: "Couldn't dress this look — try again.",
    });
  }
}

function queueActiveOutfitRender() {
  clearPollTimer();
  const generation = useTryOnDrawerStore.getState().renderGeneration + 1;
  useTryOnDrawerStore.setState({
    renderGeneration: generation,
    previewLookId: null,
    previewLookTitle: null,
  });
  void ensureAvatarLoaded(generation).then(() => {
    if (useTryOnDrawerStore.getState().renderGeneration !== generation) return;
    void startActiveOutfitRender(generation);
  });
}

export const useTryOnDrawerStore = create<TryOnDrawerState>((set, get) => ({
  open: false,
  itemsById: {},
  rackIds: [],
  activeIds: [],
  avatarUrl: null,
  status: "idle",
  jobId: null,
  resultUrl: null,
  error: null,
  compare: false,
  variants: [],
  lookSteps: [],
  partialNote: null,
  renderGeneration: 0,
  previewLookId: null,
  previewLookTitle: null,

  openFittingRoom: () => {
    syncChromeForTryOnDrawer(true);
    set({ open: true });
    if (!get().avatarUrl) {
      void ensureAvatarLoaded(get().renderGeneration);
    } else if (get().status === "loading_avatar") {
      set({ status: "idle", error: null });
    }
  },

  addToFittingRoom: (item) => {
    const state = get();
    if (state.rackIds.includes(item.id)) return "duplicate";
    if (state.rackIds.length >= MAX_FITTING_ROOM_ITEMS) return "full";

    syncChromeForTryOnDrawer(true);
    set({
      open: true,
      itemsById: { ...state.itemsById, [item.id]: item },
      rackIds: [...state.rackIds, item.id],
    });

    if (!get().avatarUrl) {
      void ensureAvatarLoaded(get().renderGeneration);
    } else if (get().status === "loading_avatar") {
      set({ status: "idle", error: null });
    }
    return "added";
  },

  addManyToFittingRoom: (items) => {
    let added = 0;
    let skipped = 0;
    let full = false;

    for (const item of items) {
      const result = get().addToFittingRoom(item);
      if (result === "added") added += 1;
      else if (result === "duplicate") skipped += 1;
      else {
        full = true;
        break;
      }
    }

    return { added, skipped, full };
  },

  removeFromRack: (id) => {
    const state = get();
    if (!state.rackIds.includes(id)) return;

    const rackIds = state.rackIds.filter((rackId) => rackId !== id);
    const itemsById = { ...state.itemsById };
    if (!state.activeIds.includes(id)) {
      delete itemsById[id];
    }

    set({ rackIds, itemsById });
  },

  tryOnItem: (id, opts) => {
    const state = get();
    const item = state.itemsById[id];
    if (!item) return;

    if (!item.tryonSupported) {
      syncChromeForTryOnDrawer(true);
      set({
        open: true,
        error: "This item can't be tried on virtually.",
      });
      return;
    }

    if (
      !state.activeIds.includes(id) &&
      state.activeIds.length >= MAX_FITTING_ROOM_ITEMS
    ) {
      syncChromeForTryOnDrawer(true);
      set({
        open: true,
        error: "You can wear up to six pieces at once.",
      });
      return;
    }

    const activeItems = state.activeIds
      .map((activeId) => state.itemsById[activeId])
      .filter(Boolean) as FittingRoomItem[];
    const conflict = findActiveSlotConflict(activeItems, item);
    const candidateType = fittingRoomGarmentType(item);

    let activeIds = state.activeIds;
    if (
      conflict &&
      !state.activeIds.includes(id) &&
      candidateType
    ) {
      if (!opts?.replaceSameType) {
        syncChromeForTryOnDrawer(true);
        set({
          open: true,
          error: slotGuardMessage(conflict),
        });
        return;
      }
      activeIds = state.activeIds.filter((activeId) => {
        const active = state.itemsById[activeId];
        if (!active) return true;
        return fittingRoomGarmentType(active) !== candidateType;
      });
    }

    activeIds =
      activeIds.includes(id) ? activeIds : [...activeIds, id];

    syncChromeForTryOnDrawer(true);
    set({
      open: true,
      itemsById: { ...state.itemsById, [id]: item },
      activeIds,
      error: null,
    });

    queueActiveOutfitRender();
  },

  openLookTryOn: (params) => {
    clearPollTimer();
    const generation = get().renderGeneration + 1;
    syncChromeForTryOnDrawer(true);

    const lookItems = params.items ?? [];
    const itemsById = { ...get().itemsById };
    const rackIds: string[] = [];
    for (const item of lookItems) {
      itemsById[item.id] = item;
      if (
        !rackIds.includes(item.id) &&
        rackIds.length < MAX_FITTING_ROOM_ITEMS
      ) {
        rackIds.push(item.id);
      }
    }

    set({
      open: true,
      renderGeneration: generation,
      previewLookId: params.lookId,
      previewLookTitle: params.title,
      // Seed candidate rack with this look's pieces (replace so the rack matches the look).
      ...(lookItems.length
        ? {
            itemsById,
            rackIds,
          }
        : {}),
      status: "loading_avatar",
      error: null,
      jobId: null,
      resultUrl: null,
      compare: false,
      variants: [],
      lookSteps: [],
      partialNote: null,
    });
    void ensureAvatarLoaded(generation).then(() => {
      if (get().renderGeneration !== generation) return;
      void startLookTryonJob(generation, params);
    });
  },

  openAndDressItems: (params) => {
    clearPollTimer();
    const generation = get().renderGeneration + 1;
    syncChromeForTryOnDrawer(true);

    const itemsById = { ...get().itemsById };
    const rackIds: string[] = [];
    const activeIds: string[] = [];
    const activeItems: FittingRoomItem[] = [];

    for (const item of params.items) {
      itemsById[item.id] = item;
      if (
        !rackIds.includes(item.id) &&
        rackIds.length < MAX_FITTING_ROOM_ITEMS
      ) {
        rackIds.push(item.id);
      }
      // One piece per garment slot — e.g. 3 tees on a single-item rack
      // stay on the rail, but only the first dresses the twin.
      if (
        item.tryonSupported &&
        !activeIds.includes(item.id) &&
        activeIds.length < MAX_FITTING_ROOM_ITEMS &&
        !findActiveSlotConflict(activeItems, item)
      ) {
        activeIds.push(item.id);
        activeItems.push(item);
      }
    }

    set({
      open: true,
      renderGeneration: generation,
      itemsById,
      rackIds,
      activeIds,
      previewLookId: null,
      previewLookTitle: params.title ?? null,
      status: "loading_avatar",
      error: null,
      jobId: null,
      resultUrl: null,
      compare: false,
      variants: [],
      lookSteps: [],
      partialNote: null,
    });

    void ensureAvatarLoaded(generation).then(() => {
      if (get().renderGeneration !== generation) return;
      if (!get().activeIds.length) {
        set({
          status: get().avatarUrl ? "idle" : "failed",
          error: get().avatarUrl
            ? null
            : "None of these pieces support try-on.",
        });
        return;
      }
      void startActiveOutfitRender(generation);
    });
  },

  removeFromAvatar: (id) => {
    const state = get();
    if (!state.activeIds.includes(id)) return;

    const activeIds = state.activeIds.filter((activeId) => activeId !== id);
    const itemsById = { ...state.itemsById };
    if (!state.rackIds.includes(id)) {
      delete itemsById[id];
    }

    set({ activeIds, itemsById });

    if (!activeIds.length) {
      clearPollTimer();
      set({
        status: "idle",
        jobId: null,
        resultUrl: null,
        error: null,
        compare: false,
        variants: [],
        lookSteps: [],
        partialNote: null,
        renderGeneration: get().renderGeneration + 1,
      });
      return;
    }

    queueActiveOutfitRender();
  },

  openAvatarViewer: async () => {
    const current = get();
    if (current.open) {
      get().close();
      return;
    }

    if (current.resultUrl && current.activeIds.length > 0) {
      clearPollTimer();
      syncChromeForTryOnDrawer(true);
      set({
        open: true,
        status: "completed",
        error: null,
      });
      return;
    }

    clearPollTimer();
    const generation = get().renderGeneration + 1;
    const warm = current.avatarUrl ?? readWarmAvatarUrl();
    syncChromeForTryOnDrawer(true);
    set({
      open: true,
      renderGeneration: generation,
      status: warm ? "idle" : "loading_avatar",
      avatarUrl: warm,
      error: null,
      compare: false,
      variants: [],
      lookSteps: [],
      partialNote: null,
      resultUrl: null,
      jobId: null,
    });

    // Keep self-store warm for the edge peek
    void useSelfAvatarStore.getState().refresh();

    try {
      const res = await fetch("/api/tryon/latest", { cache: "no-store" });
      if (get().renderGeneration !== generation) return;

      if (res.status === 401) {
        set({ open: false, status: "idle" });
        useSelfAvatarStore.getState().openCreateFlow();
        return;
      }

      if (!res.ok) {
        const fallback = get().avatarUrl ?? readWarmAvatarUrl();
        set({
          avatarUrl: fallback,
          status: fallback ? "idle" : "failed",
          error: fallback
            ? null
            : "Couldn't load your avatar — try again.",
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

      const resolvedUrl =
        body.avatar_url ?? get().avatarUrl ?? readWarmAvatarUrl();

      if (!body.has_avatar && !resolvedUrl) {
        // Stay open with a clear empty state — don't bounce the drawer closed.
        set({
          status: "failed",
          avatarUrl: null,
          error: "Create your Shoop card to see yourself here.",
        });
        useSelfAvatarStore.getState().openCreateFlow();
        return;
      }

      if (resolvedUrl) {
        useSelfAvatarStore.getState().markReady(resolvedUrl);
      }

      const tryon = body.tryon;
      if (tryon?.image_url) {
        set({
          avatarUrl: resolvedUrl,
          resultUrl: tryon.image_url,
          jobId: tryon.job_id,
          status: "completed",
          error: null,
        });
        return;
      }

      set({
        avatarUrl: resolvedUrl,
        resultUrl: null,
        jobId: null,
        status: resolvedUrl ? "idle" : "failed",
        error: resolvedUrl
          ? null
          : "Couldn't load your avatar — try again.",
      });
    } catch {
      if (get().renderGeneration !== generation) return;
      const fallback = get().avatarUrl ?? readWarmAvatarUrl();
      set({
        avatarUrl: fallback,
        status: fallback ? "idle" : "failed",
        error: fallback
          ? null
          : "Couldn't load your avatar — try again.",
      });
    }
  },

  close: () => {
    clearPollTimer();
    set({
      open: false,
      renderGeneration: get().renderGeneration + 1,
      previewLookId: null,
      previewLookTitle: null,
      status: get().activeIds.length ? get().status : "idle",
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

  isInRack: (id) => get().rackIds.includes(id),
  isActive: (id) => get().activeIds.includes(id),
  isRackFull: () => get().rackIds.length >= MAX_FITTING_ROOM_ITEMS,
  isActiveFull: () => get().activeIds.length >= MAX_FITTING_ROOM_ITEMS,
}));
