"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Bookmark, Clock, Heart, Settings } from "lucide-react";
import { useChatStore } from "@/components/chat/chat-store";
import {
  sidebarBadgeClass,
  sidebarMenuItemClass,
  sidebarSectionLabelClass,
} from "@/components/chat/sidebar-styles";
import {
  LISTS_COMING_SOON_TOAST,
  ORDERS_COMING_SOON_TOAST,
} from "@/lib/client/coming-soon-toasts";
import type { ToastPayload } from "@/lib/client/toast-store";
import { useToastStore } from "@/lib/client/toast-store";
import { useShowSettingsBadge } from "@/hooks/useUserIdentity";

function MenuBadge({ count }: { count: number }) {
  return <span className={sidebarBadgeClass}>{count}</span>;
}

function SidebarMenuItem({
  icon: Icon,
  label,
  badge,
  comingSoonToast,
  href,
}: {
  icon: LucideIcon;
  label: string;
  badge?: number;
  comingSoonToast?: ToastPayload;
  href?: string;
}) {
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const showToast = useToastStore((s) => s.show);

  const content = (
    <>
      <Icon className="size-4 shrink-0 text-ink-secondary" strokeWidth={1.75} />
      <span className="min-w-0 truncate">{label}</span>
      {badge ? <MenuBadge count={badge} /> : null}
    </>
  );

  if (comingSoonToast) {
    return (
      <button
        type="button"
        className={sidebarMenuItemClass}
        onClick={() => showToast(comingSoonToast)}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      href={href!}
      className={sidebarMenuItemClass}
      onClick={() => setSidebarOpen(false)}
    >
      {content}
    </Link>
  );
}

export function SidebarMenuSection() {
  const showSettingsBadge = useShowSettingsBadge();

  return (
    <div className="mt-5">
      <p className={sidebarSectionLabelClass}>Menu</p>
      <nav>
        <SidebarMenuItem icon={Heart} label="Moodboard" href="/moodboard" />
        <SidebarMenuItem
          icon={Clock}
          label="Orders"
          comingSoonToast={ORDERS_COMING_SOON_TOAST}
        />
        <SidebarMenuItem
          icon={Bookmark}
          label="My lists"
          comingSoonToast={LISTS_COMING_SOON_TOAST}
        />
        <SidebarMenuItem
          icon={Settings}
          label="Settings"
          badge={showSettingsBadge ? 1 : undefined}
          href="/profile"
        />
      </nav>
    </div>
  );
}
