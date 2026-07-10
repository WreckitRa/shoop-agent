import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = createPageMetadata({
  title: "Conversation",
  description: "Your private shopping conversation with Shoop.",
  noIndex: true,
});

/** Route exists for metadata + deep links; UI lives in `(chat)/layout.tsx`. */
export default function ConversationPage() {
  return null;
}
