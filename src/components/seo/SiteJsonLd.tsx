import {
  organizationJsonLd,
  webSiteJsonLd,
} from "@/lib/seo/site";

export function SiteJsonLd() {
  const payload = [organizationJsonLd(), webSiteJsonLd()];
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }}
    />
  );
}
