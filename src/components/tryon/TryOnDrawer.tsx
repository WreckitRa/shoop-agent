"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { FittingStage } from "./FittingStage";
import { useTryOnDrawerStore } from "./tryon-drawer-store";
import { isChatRoutePathname } from "@/lib/shared/chatRoutes";

/** Overlay when trying on — except desktop chat, which uses the 40/40/20 stage. */
export function TryOnDrawer() {
  const open = useTryOnDrawerStore((s) => s.open);
  const pathname = usePathname();
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  if (!open) return null;
  if (desktop && isChatRoutePathname(pathname)) return null;
  return <FittingStage layout="overlay" />;
}
