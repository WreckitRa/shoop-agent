import type { Metadata } from "next";

/** Public marketing name (OG site_name, applicationName). */
export const SITE_NAME = "Shoop";

/** Short value prop for title suffix and OG headlines. */
export const SITE_TAGLINE = "AI Shopping Concierge";

/**
 * Primary meta description (~155 chars). Used on home + default OG/Twitter.
 */
export const SITE_DESCRIPTION =
  "Shoop is your AI shopping concierge. Search every store, compare real products, and get honest buy, wait, or skip picks tailored to you.";

export const SITE_KEYWORDS = [
  "AI shopping assistant",
  "shopping concierge",
  "product search",
  "compare products",
  "personalized shopping",
  "buy recommendations",
  "gift finder",
  "online shopping help",
];

/** Next.js-generated 1200×630 PNG (see `app/opengraph-image.tsx`). */
export const DEFAULT_OG_IMAGE_PATH = "/opengraph-image";

export function defaultShareImages(alt: string) {
  const url = absoluteAsset(DEFAULT_OG_IMAGE_PATH);
  return [
    {
      url,
      width: 1200,
      height: 630,
      alt,
      type: "image/png",
    },
  ] as const;
}

/**
 * Canonical site origin for metadataBase, sitemap, robots, and JSON-LD.
 * Prefer HTTPS in production via NEXT_PUBLIC_APP_URL.
 */
export function getSiteUrl(): URL {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`
      : undefined,
    process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN.replace(/^https?:\/\//, "")}`
      : undefined,
  ];

  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    try {
      return new URL(trimmed.endsWith("/") ? trimmed : `${trimmed}/`);
    } catch {
      /* try next */
    }
  }

  return new URL("http://localhost:3000/");
}

function absoluteAsset(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return new URL(path.replace(/^\//, ""), getSiteUrl()).toString();
}

export type PageMetadataOptions = {
  /** Page title segment (becomes "{title} | Shoop" unless `absoluteTitle`). */
  title?: string;
  /** Full document title — skips the template. */
  absoluteTitle?: string;
  description?: string;
  /** Path after origin, e.g. `/profile` or `/product/abc`. */
  path?: string;
  /** When true, adds noindex,nofollow (private / thin routes). */
  noIndex?: boolean;
  ogImagePath?: string;
};

/** Per-route metadata with canonical URL, Open Graph, and Twitter cards. */
export function createPageMetadata(options: PageMetadataOptions = {}): Metadata {
  const {
    title,
    absoluteTitle,
    description = SITE_DESCRIPTION,
    path = "",
    noIndex = false,
    ogImagePath = DEFAULT_OG_IMAGE_PATH,
  } = options;

  const base = getSiteUrl();
  const canonicalPath = path.startsWith("/") ? path : path ? `/${path}` : "/";
  const canonical = new URL(canonicalPath, base).toString();
  const documentTitle =
    absoluteTitle ??
    (title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} — ${SITE_TAGLINE}`);
  const ogImage = absoluteAsset(ogImagePath);
  const isGeneratedCard = ogImagePath === DEFAULT_OG_IMAGE_PATH;
  const shareImages = isGeneratedCard
    ? defaultShareImages(`${SITE_NAME} — ${SITE_TAGLINE}`)
    : [
        {
          url: ogImage,
          alt: `${SITE_NAME} — ${SITE_TAGLINE}`,
          ...(ogImagePath.endsWith(".png") || ogImagePath.includes("opengraph")
            ? { width: 1200, height: 630, type: "image/png" as const }
            : {}),
        },
      ];

  return {
    ...(absoluteTitle ? { title: absoluteTitle } : title ? { title } : {}),
    description,
    alternates: { canonical },
    robots: noIndex
      ? { index: false, follow: false, googleBot: { index: false, follow: false } }
      : {
          index: true,
          follow: true,
          googleBot: { index: true, follow: true, "max-image-preview": "large" },
        },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: documentTitle,
      description,
      url: canonical,
      locale: "en_US",
      images: [...shareImages],
    },
    twitter: {
      card: "summary_large_image",
      title: documentTitle,
      description,
      images: shareImages.map((img) => img.url),
    },
  };
}

/** Root layout defaults — child routes merge via title.template. */
export function rootMetadata(): Metadata {
  const base = getSiteUrl();
  const shareImages = defaultShareImages(`${SITE_NAME} — ${SITE_TAGLINE}`);

  return {
    metadataBase: base,
    title: {
      default: `${SITE_NAME} — ${SITE_TAGLINE}`,
      template: `%s | ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    creator: SITE_NAME,
    publisher: SITE_NAME,
    category: "shopping",
    keywords: SITE_KEYWORDS,
    formatDetection: {
      email: false,
      address: false,
      telephone: false,
    },
    alternates: {
      canonical: base.origin,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: `${SITE_NAME} — ${SITE_TAGLINE}`,
      description: SITE_DESCRIPTION,
      url: base.origin,
      locale: "en_US",
      images: [...shareImages],
    },
    twitter: {
      card: "summary_large_image",
      title: `${SITE_NAME} — ${SITE_TAGLINE}`,
      description: SITE_DESCRIPTION,
      images: shareImages.map((img) => img.url),
    },
    icons: {
      icon: [{ url: "/assets/shoop-icon.svg", type: "image/svg+xml" }],
      apple: [{ url: "/assets/shoop-icon.svg", type: "image/svg+xml" }],
    },
  };
}

export function organizationJsonLd(): Record<string, unknown> {
  const base = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: base.origin,
    logo: absoluteAsset("/assets/shoop-logo.svg"),
    description: SITE_DESCRIPTION,
  };
}

export function webSiteJsonLd(): Record<string, unknown> {
  const base = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: base.origin,
    description: SITE_DESCRIPTION,
    publisher: { "@type": "Organization", name: SITE_NAME },
  };
}
