"use client";

import { Heart, Shirt, Sparkles, Tag } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import { useChatStore } from "@/components/chat/chat-store";

type Props = {
  onSelect?: (prompt: string) => void;
  className?: string;
};

type Chip = {
  label: string;
  prompt: string;
};

const CHIPS: Chip[] = [
  {
    label: "what do I wear to a wedding?",
    prompt: "What should I wear to a wedding?",
  },
  {
    label: "style this blazer",
    prompt: "Help me style a blazer I already own",
  },
  {
    label: "like this, for less",
    prompt: "Find me something like this, for less",
  },
  {
    label: "gift for someone",
    prompt: "Help me find a gift for someone",
  },
];

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

function useQuickActionSelect(onSelect?: (prompt: string) => void) {
  const setInput = useChatStore((s) => s.setInput);
  const requestComposerFocus = useChatStore((s) => s.requestComposerFocus);

  return (prompt: string) => {
    if (onSelect) {
      onSelect(prompt);
      return;
    }
    setInput(prompt);
    requestComposerFocus();
    revealComposer();
  };
}

export function HomeQuickActions({ onSelect, className }: Props) {
  const select = useQuickActionSelect(onSelect);

  return (
    <div
      className={cn("flex flex-wrap gap-2", className)}
      role="group"
      aria-label="Quick starts"
    >
      {CHIPS.map((chip) => (
        <button
          key={chip.label}
          type="button"
          onClick={() => select(chip.prompt)}
          className="shoop-a-chip"
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}

export function HomeMobileActionGrid() {
  const select = useQuickActionSelect();

  return (
    <div className="grid grid-cols-4 gap-2 sm:gap-2.5">
      {MOBILE_QUICK_ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            className="flex min-h-[58px] flex-col items-center justify-center gap-1.5 rounded-[16px] border border-hairline bg-white px-1 py-2 text-center shadow-soft transition active:scale-[0.98] sm:min-h-0 sm:gap-2 sm:rounded-[18px] sm:px-1.5 sm:py-3"
            onClick={() => select(action.prompt)}
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
