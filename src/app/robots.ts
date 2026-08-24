import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl().origin;

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/legal/"],
        disallow: [
          "/api/",
          "/c/",
          "/ask/",
          "/profile",
          "/_next/",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
