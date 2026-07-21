"use client";

import {
  ArrowRight,
  Gift,
  Heart,
  Layers,
  Shirt,
  Sparkles,
  Tag,
} from "lucide-react";
import { useChatStore } from "@/components/chat/chat-store";

const DESKTOP_QUICK_ACTIONS = [
  {
    id: "wedding-guest",
    label: "what do I wear to a wedding?",
    prompt:
      "What do I wear to a wedding? I’m a guest in Sardinia in May, and my budget is $400.",
    icon: Sparkles,
  },
  {
    id: "gift",
    label: "find a gift for my wife",
    prompt:
      "Find an anniversary gift for my wife — she loves sculptural gold jewelry, and my budget is $300.",
    icon: Gift,
  },
  {
    id: "style-blazer",
    label: "style this blazer",
    prompt:
      "Style my navy blazer for a smart-casual dinner — warm weather, polished but relaxed.",
    icon: Sparkles,
  },
  {
    id: "compare",
    label: "compare similar pieces",
    prompt:
      "Compare similar pieces for me — prioritize quality, fit, and cost per wear, then tell me which is worth buying.",
    icon: Layers,
  },
] as const;

const MOBILE_QUICK_ACTIONS = [
  {
    id: "wedding-guest",
    label: "Wedding Guest",
    prompt:
      "What do I wear to a wedding? I’m a guest in Sardinia in May, and my budget is $400.",
    icon: Sparkles,
  },
  {
    id: "compare-prices",
    label: "Compare Prices",
    prompt:
      "Compare prices on similar pieces — prioritize quality and cost per wear, then tell me which is the better buy.",
    icon: Tag,
  },
  {
    id: "style-advice",
    label: "Style Advice",
    prompt:
      "Build me a polished weekend outfit — warm undertone, relaxed fit, and a $250 budget.",
    icon: Shirt,
  },
  {
    id: "track-deals",
    label: "Track Deals",
    prompt:
      "Find the best current deals on quality wardrobe staples under $150 — skip anything that only looks cheap.",
    icon: Heart,
  },
] as const;

function revealComposer() {
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask Shoop"]')
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

export function HomeQuickActions() {
  const setInput = useChatStore((s) => s.setInput);
  const requestComposerFocus = useChatStore((s) => s.requestComposerFocus);

  return (
    <div className="grid w-full grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3">
      {DESKTOP_QUICK_ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            className="shoop-home-quick-action group flex min-h-[132px] flex-col items-stretch rounded-[18px] bg-[#EFEDE9] px-4 pb-3.5 pt-4 text-left transition duration-150 hover:bg-[#E8E5E0] active:scale-[0.99]"
            onClick={() => {
              setInput(action.prompt);
              requestComposerFocus();
              revealComposer();
            }}
          >
            <Icon
              className="size-[18px] text-ink"
              strokeWidth={1.5}
              aria-hidden
            />
            <span className="mt-4 min-w-0 flex-1 text-[13px] font-medium leading-[1.35] tracking-[-0.01em] text-ink lowercase">
              {action.label}
            </span>
            <span className="mt-3 flex justify-end">
              <ArrowRight
                className="size-3.5 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-ink"
                strokeWidth={1.5}
                aria-hidden
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function HomeMobileActionGrid() {
  const setInput = useChatStore((s) => s.setInput);
  const requestComposerFocus = useChatStore((s) => s.requestComposerFocus);

  return (
    <div className="grid grid-cols-4 gap-2 sm:gap-2.5">
      {MOBILE_QUICK_ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            className="flex min-h-[58px] flex-col items-center justify-center gap-1.5 rounded-[16px] bg-white px-1 py-2 text-center shadow-soft ring-1 ring-hairline/70 transition active:scale-[0.98] sm:min-h-0 sm:gap-2 sm:rounded-[18px] sm:px-1.5 sm:py-3"
            onClick={() => {
              setInput(action.prompt);
              requestComposerFocus();
              revealComposer();
            }}
          >
            <Icon
              className="size-[18px] text-ink-secondary"
              strokeWidth={1.5}
              aria-hidden
            />
            <span className="text-[10px] font-medium leading-[1.25] tracking-[-0.01em] text-ink sm:text-[11px]">
              {action.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const HOW_IT_WORKS = [
  "Tell me the occasion",
  "See it on you",
  "One cart across every store",
] as const;

export function HomeHowItWorks() {
  return (
    <ol
      className="shoop-home-how-it-works grid grid-cols-3 overflow-hidden rounded-[16px] border border-hairline bg-white/70 sm:rounded-[18px]"
      aria-label="How Shoop works"
    >
      {HOW_IT_WORKS.map((step, index) => (
        <li
          key={step}
          className="relative flex min-h-[52px] items-center px-2 py-1.5 sm:min-h-[72px] sm:px-4 sm:py-3"
        >
          <div>
            <span className="block text-[9px] font-semibold tabular-nums tracking-[0.12em] text-ink-muted">
              0{index + 1}
            </span>
            <span className="mt-0.5 block text-[10px] font-medium leading-[1.2] text-ink sm:mt-1 sm:text-[12px] sm:leading-[1.3]">
              {step}
            </span>
          </div>
          {index < HOW_IT_WORKS.length - 1 ? (
            <ArrowRight
              className="absolute right-0 top-1/2 size-3 -translate-y-1/2 translate-x-1/2 text-ink-muted"
              strokeWidth={1.5}
              aria-hidden
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
