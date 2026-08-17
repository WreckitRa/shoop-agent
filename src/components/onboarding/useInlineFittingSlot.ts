"use client";

import { useLayoutEffect, useState } from "react";
import {
  getInlineFittingCardSlot,
  getInlineFittingSlot,
  useInlineFittingStore,
} from "@/components/onboarding/inline-fitting-store";

/** Portal targets for signup/onboarding when the chat Fitting stage is open. */
export function useInlineFittingSlots(): {
  questions: HTMLElement | null;
  card: HTMLElement | null;
} {
  const columnOpen = useInlineFittingStore((s) => s.columnOpen);
  const [slots, setSlots] = useState<{
    questions: HTMLElement | null;
    card: HTMLElement | null;
  }>(() =>
    columnOpen
      ? {
          questions: getInlineFittingSlot(),
          card: getInlineFittingCardSlot(),
        }
      : { questions: null, card: null },
  );

  useLayoutEffect(() => {
    if (!columnOpen) {
      setSlots({ questions: null, card: null });
      return;
    }
    setSlots({
      questions: getInlineFittingSlot(),
      card: getInlineFittingCardSlot(),
    });
  }, [columnOpen]);

  if (!columnOpen) return { questions: null, card: null };
  return {
    questions: slots.questions ?? getInlineFittingSlot(),
    card: slots.card ?? getInlineFittingCardSlot(),
  };
}

export function useInlineFittingSlot(): HTMLElement | null {
  return useInlineFittingSlots().questions;
}
