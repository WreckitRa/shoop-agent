import { loadShareByToken } from "@/lib/ask/create-share";
import { absoluteAskLookImageUrl } from "@/lib/ask/og-image";

export const runtime = "nodejs";
export const alt = "The look — should they get it?";
export const contentType = "image/jpeg";

type Props = { params: Promise<{ token: string }> };

/**
 * Route-level OG image so `/ask/[token]` does not inherit the brand
 * `app/opengraph-image` card. Serves the shared look photo as-is.
 */
export default async function Image({ params }: Props) {
  const { token } = await params;
  if (!token || token.length > 32) {
    return new Response("Not found", { status: 404 });
  }

  const share = await loadShareByToken(token);
  const src = share?.imageUrl
    ? absoluteAskLookImageUrl(share.imageUrl)
    : "";
  if (!src) {
    return new Response("Not found", { status: 404 });
  }

  const upstream = await fetch(src, {
    next: { revalidate: 86_400 },
  });
  if (!upstream.ok) {
    return new Response("Not found", { status: 404 });
  }

  const type = upstream.headers.get("content-type") || "image/jpeg";
  const bytes = await upstream.arrayBuffer();
  return new Blob([bytes], { type });
}
