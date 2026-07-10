"use client";

import {
  ArrowRight,
  Gift,
  Heart,
  Layers,
  Search,
  Shirt,
  Sparkles,
  Tag,
} from "lucide-react";
import { useChatStore } from "@/components/chat/chat-store";

const DESKTOP_QUICK_ACTIONS = [
  {
    id: "summer-outfit",
    label: "build a summer outfit",
    prompt: "Help me build a polished summer outfit",
    icon: Shirt,
  },
  {
    id: "gift",
    label: "find a gift for my wife",
    prompt: "Help me find a thoughtful gift for my wife",
    icon: Gift,
  },
  {
    id: "style-blazer",
    label: "style this blazer",
    prompt: "Help me style a blazer for a refined everyday look",
    icon: Sparkles,
  },
  {
    id: "compare",
    label: "compare similar pieces",
    prompt: "Compare similar pieces and tell me which is worth buying",
    icon: Layers,
  },
] as const;

const MOBILE_QUICK_ACTIONS = [
  {
    id: "find-item",
    label: "Find an Item",
    prompt: "Help me find an item",
    icon: Search,
  },
  {
    id: "compare-prices",
    label: "Compare Prices",
    prompt: "Compare prices and tell me which is the better buy",
    icon: Tag,
  },
  {
    id: "style-advice",
    label: "Style Advice",
    prompt: "Give me style advice for what I should wear",
    icon: Shirt,
  },
  {
    id: "track-deals",
    label: "Track Deals",
    prompt: "Help me track deals and find what's worth buying now",
    icon: Heart,
  },
] as const;

export function HomeQuickActions() {
  const setInput = useChatStore((s) => s.setInput);
  const sendMessage = useChatStore((s) => s.sendMessage);

  return (
    <div className="grid w-full grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3">
      {DESKTOP_QUICK_ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            className="group flex min-h-[132px] flex-col items-stretch rounded-[18px] bg-[#EFEDE9] px-4 pb-3.5 pt-4 text-left transition duration-150 hover:bg-[#E8E5E0] active:scale-[0.99]"
            onClick={() => {
              setInput(action.prompt);
              void sendMessage();
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
  const sendMessage = useChatStore((s) => s.sendMessage);

  return (
    <div className="grid grid-cols-4 gap-2 sm:gap-2.5">
      {MOBILE_QUICK_ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            className="flex flex-col items-center gap-2 rounded-[18px] bg-white px-1.5 py-3 text-center shadow-soft ring-1 ring-hairline/70 transition active:scale-[0.98]"
            onClick={() => {
              setInput(action.prompt);
              void sendMessage();
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
