import { ChatShell } from "@/components/chat/ChatShell";

/** Keeps chat UI mounted across `/` ↔ `/c/:id` navigations (prevents first-send flicker). */
export default function ChatRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <ChatShell />
    </>
  );
}
