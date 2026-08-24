import { LegalArticle } from "@/components/legal/LegalArticle";
import { legalDocument } from "@/lib/legal/documents";
import { createPageMetadata } from "@/lib/seo/site";

const doc = legalDocument("cookies");

export const metadata = createPageMetadata({
  title: doc.title,
  description: doc.description,
  path: doc.href,
});

export default function CookiesPage() {
  return <LegalArticle doc={doc} />;
}
