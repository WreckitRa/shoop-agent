import type { Metadata } from "next";
import { AskLookCard } from "@/components/ask/AskLookCard";
import { loadShareByToken } from "@/lib/ask/create-share";
import { absoluteAskLookImageUrl } from "@/lib/ask/og-image";
import { createPageMetadata, SITE_NAME } from "@/lib/seo/site";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const share =
    token && token.length <= 32 ? await loadShareByToken(token) : null;

  if (!share) {
    return createPageMetadata({
      absoluteTitle: `Look not found · ${SITE_NAME}`,
      description: "This Ask card isn’t available.",
      path: `/ask/${token}`,
      noIndex: true,
    });
  }

  const asker =
    share.askerName.trim().split(/\s+/)[0] || share.askerName.trim() || "they";
  const lookImage = absoluteAskLookImageUrl(share.imageUrl);
  const title = `Should ${asker} get it? · ${SITE_NAME}`;
  const description = "Vote before you peek at Shoop’s verdict.";
  const imageAlt = `${asker}'s try-on look`;

  const base = createPageMetadata({
    absoluteTitle: title,
    description,
    path: `/ask/${share.token}`,
    noIndex: true,
    // Prefer the look photo over the brand OG card in metas.
    ogImagePath: lookImage || undefined,
  });

  if (!lookImage) return base;

  return {
    ...base,
    openGraph: {
      ...base.openGraph,
      images: [{ url: lookImage, alt: imageAlt }],
    },
    twitter: {
      ...base.twitter,
      card: "summary_large_image",
      images: [lookImage],
    },
  };
}

export default async function AskLookPage({ params }: Props) {
  const { token } = await params;
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#E9E9EE]">
      <AskLookCard token={token} />
    </main>
  );
}
