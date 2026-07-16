"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/ai-chat/cn";
import { Loader2, Sparkles, X } from "lucide-react";
import { TRYON_DISCLAIMER } from "@/lib/tryon/types";
import { TryOnComparePanel } from "./TryOnComparePanel";
import {
  useTryOnDrawerStore,
  type TryOnDrawerItem,
} from "./tryon-drawer-store";
import { useChatStore } from "@/components/chat/chat-store";
import { useInlineProductStore } from "@/components/chat/inline-product-store";
import { buildInlineProductState } from "@/lib/shared/productPanelParams";
import { stashChatFocusReturn } from "@/lib/shared/chatFocus";

const PANEL_WIDTH = "min(100vw, 28rem)";

function formatPrice(price: { amount: number; currency: string }) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: price.currency,
  }).format(price.amount / 100);
}

function GarmentShadows({ items }: { items: TryOnDrawerItem[] }) {
  const shown = items.filter((i) => i.imageUrl).slice(0, 4);
  if (!shown.length) {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[55%] w-[42%] animate-pulse rounded-2xl bg-white/35 shadow-lg ring-1 ring-white/40 backdrop-blur-[2px] motion-reduce:animate-none" />
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-0">
      {shown.map((item, index) => {
        const offset = (index - (shown.length - 1) / 2) * 18;
        const rotate = (index - (shown.length - 1) / 2) * 4;
        return (
          <div
            key={item.ref}
            className="absolute left-1/2 top-[18%] h-[58%] w-[38%] animate-pulse overflow-hidden rounded-2xl bg-white/25 shadow-[0_12px_40px_rgba(0,0,0,0.18)] ring-1 ring-white/50 backdrop-blur-[1px] motion-reduce:animate-none"
            style={{
              transform: `translateX(calc(-50% + ${offset}px)) rotate(${rotate}deg)`,
              opacity: 0.55 + index * 0.08,
              zIndex: 10 + index,
              animationDelay: `${index * 180}ms`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.imageUrl}
              alt=""
              className="size-full object-cover opacity-80 mix-blend-multiply"
            />
          </div>
        );
      })}
    </div>
  );
}

function StageStatusLine() {
  const status = useTryOnDrawerStore((s) => s.status);
  const session = useTryOnDrawerStore((s) => s.session);
  const lookSteps = useTryOnDrawerStore((s) => s.lookSteps);

  if (status === "loading_avatar") return <>Loading your avatar…</>;
  if (status === "starting") {
    return (
      <>
        {session?.kind === "look"
          ? "Starting outfit try-on…"
          : "Starting try-on…"}
      </>
    );
  }
  if (status === "processing") {
    const completed = lookSteps.filter((s) => s.status === "completed").length;
    const total = lookSteps.length;
    const allProcessing =
      total > 1 &&
      lookSteps.every(
        (s) => s.status === "processing" || s.status === "pending",
      ) &&
      lookSteps.some((s) => s.status === "processing");
    if (session?.kind === "look" && total > 0) {
      if (allProcessing && completed === 0) {
        return <>Dressing full look…</>;
      }
      const active = lookSteps.find((s) => s.status === "processing");
      return (
        <>
          {`Dressing ${Math.min(completed + 1, total)} of ${total}${
            active?.title ? ` · ${active.title}` : ""
          }`}
        </>
      );
    }
    return <>Rendering on your avatar…</>;
  }
  if (status === "completed") return <>Here's how it looks on you</>;
  if (status === "failed") return <>Couldn't finish this try-on</>;
  if (status === "idle" && session?.title === "Your avatar") {
    return <>Your avatar</>;
  }
  return null;
}

export function TryOnDrawer() {
  const open = useTryOnDrawerStore((s) => s.open);
  const session = useTryOnDrawerStore((s) => s.session);
  const avatarUrl = useTryOnDrawerStore((s) => s.avatarUrl);
  const status = useTryOnDrawerStore((s) => s.status);
  const resultUrl = useTryOnDrawerStore((s) => s.resultUrl);
  const error = useTryOnDrawerStore((s) => s.error);
  const compare = useTryOnDrawerStore((s) => s.compare);
  const variants = useTryOnDrawerStore((s) => s.variants);
  const partialNote = useTryOnDrawerStore((s) => s.partialNote);
  const close = useTryOnDrawerStore((s) => s.close);
  const sendFeedback = useTryOnDrawerStore((s) => s.sendFeedback);
  const panelRef = useRef<HTMLElement>(null);
  const conversationId = useChatStore((s) => s.activeConversationId);
  const expandProduct = useInlineProductStore((s) => s.expand);

  const openItemProduct = (item: TryOnDrawerItem) => {
    const productId = item.productId;
    const messageId = session?.searchId;
    if (!productId || !messageId) return;
    close();
    if (conversationId) {
      stashChatFocusReturn({
        conversationId,
        messageId,
        productId,
      });
    }
    expandProduct(
      buildInlineProductState(productId, {
        messageId,
        title: item.title,
        imageUrl: item.imageUrl,
        preferredOptions: item.preferredOptions,
        featuredVariant: item.featuredVariant,
        displayPrice: item.price,
      }),
    );
  };

  const busy =
    status === "loading_avatar" ||
    status === "starting" ||
    status === "processing";
  const showResult = Boolean(resultUrl) && status === "completed";

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (panelRef.current?.contains(target)) return;
      if (target.closest("[data-tryon-trigger]")) return;
      if (
        target.closest(
          "input, textarea, select, button, a, [contenteditable], [role='button'], [role='link'], [role='textbox']",
        )
      ) {
        return;
      }
      close();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const statusLine = <StageStatusLine />;

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-label="Virtual try-on"
      aria-hidden={!open}
      style={{ width: open ? PANEL_WIDTH : "0px" }}
      className={cn(
        "relative z-20 flex h-full shrink-0 flex-col overflow-hidden border-hairline bg-white shadow-[-12px_0_40px_rgba(12,12,12,0.06)] transition-[width] duration-300 ease-out",
        open ? "border-l" : "pointer-events-none border-l-0",
      )}
      data-tryon-drawer
    >
      <div
        style={{ width: PANEL_WIDTH }}
        className={cn("flex h-full min-w-0 flex-col", !open && "invisible")}
      >
        <header className="flex items-center justify-between border-b border-hairline-soft px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-brand" aria-hidden />
              <h2 className="font-serif text-xl font-semibold tracking-tight text-ink">
                Try on
              </h2>
            </div>
            {session ? (
              <p className="mt-0.5 truncate text-xs text-ink-muted">
                {session.title}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={close}
            className="inline-flex size-9 items-center justify-center rounded-xl text-ink-soft transition hover:bg-surface-tint hover:text-ink"
            aria-label="Close try-on"
          >
            <X className="size-5" strokeWidth={1.75} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
          <div
            className="relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-2xl bg-surface-tint ring-1 ring-hairline"
            aria-busy={busy}
          >
            {showResult ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resultUrl!}
                alt="Your try-on"
                className="max-h-full max-w-full object-contain"
              />
            ) : avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt="Your avatar"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-2 text-ink-muted">
                <Loader2 className="size-5 animate-spin" aria-hidden />
                <p className="text-xs">Loading avatar…</p>
              </div>
            )}

            {busy && avatarUrl ? (
              <>
                <div className="absolute inset-0 bg-ink/15 backdrop-brightness-95" />
                <GarmentShadows items={session?.items ?? []} />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/55 via-ink/20 to-transparent px-4 pb-4 pt-16">
                  <div className="flex items-center gap-2 text-white">
                    <Loader2
                      className="size-4 shrink-0 animate-spin"
                      aria-hidden
                    />
                    <p className="text-sm font-medium">{statusLine}</p>
                  </div>
                </div>
              </>
            ) : null}

            {busy && !avatarUrl ? (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/40 to-transparent px-4 pb-4 pt-10">
                <p className="text-sm font-medium text-white">{statusLine}</p>
              </div>
            ) : null}
          </div>

          <p className="mt-2 text-[10px] text-ink-muted">{TRYON_DISCLAIMER}</p>

          {status === "idle" && avatarUrl && !resultUrl ? (
            <p className="mt-3 text-sm text-ink-secondary">
              Your avatar is ready — tap{" "}
              <span className="font-medium text-ink">See it on you</span> on a
              pick to dress it.
            </p>
          ) : null}

          {error ? (
            <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}

          {partialNote && !error && status === "completed" ? (
            <p className="mt-2 text-xs text-ink-muted">{partialNote}</p>
          ) : null}

          {showResult ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded-full border border-hairline-soft px-3 py-1 text-xs"
                onClick={() => sendFeedback(1)}
                aria-label="Helpful try-on"
              >
                👍 Helpful
              </button>
              <button
                type="button"
                className="rounded-full border border-hairline-soft px-3 py-1 text-xs"
                onClick={() => sendFeedback(-1)}
                aria-label="Unhelpful try-on"
              >
                👎 Not quite
              </button>
            </div>
          ) : null}

          {compare && variants.length > 0 && status !== "failed" ? (
            <div className="mt-4">
              <TryOnComparePanel
                variants={variants}
                items={(session?.items ?? []).map((i) => ({
                  ref: i.ref,
                  title: i.title,
                  price: i.price,
                }))}
                badgesByRef={session?.badgesByRef}
                onOpenProduct={(ref) => {
                  const item = session?.items.find((i) => i.ref === ref);
                  if (item) openItemProduct(item);
                }}
                onFeedback={(generationId, rating) =>
                  sendFeedback(rating, generationId)
                }
              />
            </div>
          ) : null}

          {session?.items.length ? (
            <ul className="mt-5 space-y-2 border-t border-hairline-soft pt-4">
              {session.items.map((item) => (
                <li key={item.ref}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl border border-hairline-soft p-2 text-left transition hover:bg-surface-tint"
                    onClick={() => openItemProduct(item)}
                    disabled={!item.productId}
                  >
                    <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-surface-tint">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium text-ink">
                        {item.title}
                      </p>
                      {item.price ? (
                        <p className="text-xs text-ink-muted">
                          {formatPrice(item.price)}
                        </p>
                      ) : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
