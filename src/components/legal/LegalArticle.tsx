"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Components } from "react-markdown";
import { ShoopLogo } from "@/components/brand/ShoopBrand";
import { cn } from "@/lib/ai-chat/cn";
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal/constants";
import { legalNavFor, type LegalDocument } from "@/lib/legal/documents";

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), "target", "rel"],
  },
};

const markdownComponents: Components = {
  a({ href, children }) {
    const mailto = href?.startsWith("mailto:");
    const internal = href?.startsWith("/");
    const external =
      href?.startsWith("http://") || href?.startsWith("https://");
    if (!mailto && !internal && !external) {
      return <span>{children}</span>;
    }
    return (
      <Link
        href={href!}
        {...(external
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
        className="font-semibold text-[var(--fitting-ink)] underline decoration-[var(--fitting-red)] decoration-2 underline-offset-[3px] hover:text-[var(--fitting-red)]"
      >
        {children}
      </Link>
    );
  },
  h2({ children }) {
    return (
      <h2 className="mt-10 font-display text-[22px] font-extrabold tracking-[-0.02em] text-[var(--fitting-ink)] first:mt-0 md:text-[26px]">
        {children}
      </h2>
    );
  },
  h3({ children }) {
    return (
      <h3 className="mt-7 font-display text-[18px] font-extrabold text-[var(--fitting-ink)]">
        {children}
      </h3>
    );
  },
  p({ children }) {
    return (
      <p className="mt-3 text-[15px] leading-[1.65] text-[#3A3A44] md:text-[16px]">
        {children}
      </p>
    );
  },
  strong({ children }) {
    return (
      <strong className="font-extrabold text-[var(--fitting-ink)]">
        {children}
      </strong>
    );
  },
  ul({ children }) {
    return (
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15px] leading-[1.65] text-[#3A3A44]">
        {children}
      </ul>
    );
  },
  ol({ children }) {
    return (
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[15px] leading-[1.65] text-[#3A3A44]">
        {children}
      </ol>
    );
  },
  li({ children }) {
    return <li className="pl-1">{children}</li>;
  },
  table({ children }) {
    return (
      <div className="mt-5 overflow-x-auto rounded-[16px] border border-[var(--fitting-line)] bg-white">
        <table className="w-full min-w-[520px] border-collapse text-left text-[13.5px]">
          {children}
        </table>
      </div>
    );
  },
  thead({ children }) {
    return (
      <thead className="bg-[#F7F7F9] text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--fitting-quiet)]">
        {children}
      </thead>
    );
  },
  th({ children }) {
    return (
      <th className="border-b border-[var(--fitting-line)] px-4 py-3 font-extrabold text-[var(--fitting-ink)]">
        {children}
      </th>
    );
  },
  td({ children }) {
    return (
      <td className="border-b border-[var(--fitting-line)] px-4 py-3 align-top leading-[1.5] text-[#3A3A44] last:border-b-0">
        {children}
      </td>
    );
  },
  tr({ children }) {
    return <tr className="last:[&>td]:border-b-0">{children}</tr>;
  },
};

export function LegalArticle({ doc }: { doc: LegalDocument }) {
  const nav = legalNavFor(doc.slug);

  return (
    <article className="mx-auto w-full max-w-[760px] px-5 pb-16 pt-8 md:px-8 md:pb-24 md:pt-12">
      <p className="text-[10.5px] font-extrabold tracking-[0.16em] text-[var(--fitting-red)]">
        {doc.kick.toUpperCase()}
      </p>
      <h1 className="mt-3 font-display text-[clamp(34px,6vw,52px)] font-extrabold leading-[0.98] tracking-[-0.035em] text-[var(--fitting-ink)]">
        {doc.title}
      </h1>
      <p className="mt-4 max-w-[46ch] font-whisper text-[17px] italic leading-[1.45] text-[var(--fitting-quiet)]">
        {doc.description}
      </p>
      <p className="mt-3 text-[12px] font-semibold text-[var(--fitting-quiet)]">
        Last updated {doc.lastUpdated}
      </p>

      <nav
        aria-label="Legal documents"
        className="mt-8 flex flex-wrap gap-2 border-y border-[var(--fitting-line)] py-4"
      >
        {nav.map((item) => (
          <Link
            key={item.slug}
            href={item.href}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-[12px] font-extrabold tracking-[0.01em] transition",
              item.current
                ? "bg-[var(--fitting-ink)] text-white"
                : "border border-[#D6D6DE] bg-white text-[var(--fitting-quiet)] hover:border-[var(--fitting-ink)] hover:text-[var(--fitting-ink)]",
            )}
          >
            {item.short}
          </Link>
        ))}
      </nav>

      <div className="mt-8">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeSanitize, schema]]}
          components={markdownComponents}
        >
          {doc.markdown}
        </ReactMarkdown>
      </div>

      <footer className="mt-14 border-t border-[var(--fitting-line)] pt-8">
        <Link href="/" className="inline-flex">
          <ShoopLogo className="h-5" />
        </Link>
        <p className="mt-4 text-[13px] leading-[1.55] text-[var(--fitting-quiet)]">
          Questions:{" "}
          <a
            href={`mailto:${LEGAL_CONTACT_EMAIL}`}
            className="font-semibold text-[var(--fitting-ink)] underline underline-offset-2"
          >
            {LEGAL_CONTACT_EMAIL}
          </a>
        </p>
      </footer>
    </article>
  );
}
