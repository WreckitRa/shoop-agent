"use client";

import { useEffect, useRef } from "react";
import { isGuestSessionActive } from "@/lib/client/guest-storage";

const LEAVE_MESSAGE =
  "You might lose your cart, chats, and personalized picks if you leave or clear browser data. Sign up to save your progress on any device.";

/**
 * Warns guest users before closing or navigating away from the site.
 */
export function GuestLeavePrompt() {
  const armedRef = useRef(false);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!armedRef.current) return;
      e.preventDefault();
      e.returnValue = LEAVE_MESSAGE;
      return LEAVE_MESSAGE;
    };

    const syncArmed = () => {
      armedRef.current = isGuestSessionActive();
    };

    syncArmed();
    window.addEventListener("shoop-guest-changed", syncArmed);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("shoop-guest-changed", syncArmed);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  return null;
}
