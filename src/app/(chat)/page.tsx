import type { Metadata } from "next";
import { PreferredNameSeed } from "@/components/chat/PreferredNameSeed";
import { getUserPreferredName } from "@/lib/shared/userPreferredName";
import {
  createPageMetadata,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
} from "@/lib/seo/site";

export const metadata: Metadata = createPageMetadata({
  absoluteTitle: `${SITE_NAME} — ${SITE_TAGLINE}`,
  description: SITE_DESCRIPTION,
  path: "/",
});

export default async function HomePage() {
  const preferredName = await getUserPreferredName();
  return <PreferredNameSeed preferredName={preferredName} />;
}
