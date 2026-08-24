import { LegalArticle } from "@/components/legal/LegalArticle";
import { legalDocument } from "@/lib/legal/documents";
import { createPageMetadata } from "@/lib/seo/site";

const doc = legalDocument("privacy");

export const metadata = createPageMetadata({
  title: doc.title,
  description: doc.description,
  path: doc.href,
});

export default function PrivacyPage() {
  return <LegalArticle doc={doc} />;
}
