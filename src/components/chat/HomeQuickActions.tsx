"use client";

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
    label: "💍 what do I wear to a wedding?",
    prompt: "What should I wear to a wedding?",
  },
  {
    label: "🧥 style this blazer",
    prompt: "Help me style a blazer I already own",
  },
  {
    label: "🧵 like this, for less",
    prompt: "Find me something like this, for less",
  },
];

function revealComposer() {
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask Shoop"]')
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

export function HomeQuickActions({ onSelect, className }: Props) {
  const setInput = useChatStore((s) => s.setInput);
  const requestComposerFocus = useChatStore((s) => s.requestComposerFocus);

  const select = (prompt: string) => {
    if (onSelect) {
      onSelect(prompt);
      return;
    }
    setInput(prompt);
    requestComposerFocus();
    revealComposer();
  };

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
