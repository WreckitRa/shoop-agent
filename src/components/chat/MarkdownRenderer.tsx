"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Components } from "react-markdown";
import { CodeBlock } from "@/components/chat/CodeBlock";
import { cn } from "@/lib/ai-chat/cn";

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), "target", "rel"],
  },
};

const components: Components = {
  a({ href, children, ...props }) {
    const safe =
      href?.startsWith("http://") || href?.startsWith("https://")
        ? href
        : undefined;
    if (!safe) {
      return <span {...props}>{children}</span>;
    }
    return (
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-brand underline underline-offset-2 hover:text-brand-dark"
        {...props}
      >
        {children}
      </a>
    );
  },
  code({ className, children, ...props }) {
    const inline = !String(children).includes("\n");
    const match = /language-(\w+)/.exec(className || "");
    const lang = match?.[1];

    if (inline) {
      return (
        <code
          className={cn(
            "rounded bg-surface-tint px-1 py-0.5 font-mono text-[0.9em] text-ink",
            className,
          )}
          {...props}
        >
          {children}
        </code>
      );
    }

    const code = String(children).replace(/\n$/, "");
    return <CodeBlock language={lang}>{code}</CodeBlock>;
  },
  pre({ children }) {
    return <>{children}</>;
  },
  h1: ({ children }) => (
    <h1 className="mb-3 mt-6 text-xl font-semibold leading-snug text-ink first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-5 text-lg font-semibold leading-snug text-ink first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-4 text-base font-semibold text-ink first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="mb-3 leading-relaxed text-ink last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 ml-5 list-disc space-y-1 text-ink">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 ml-5 list-decimal space-y-1 text-ink">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed text-ink">{children}</li>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-ink">{children}</strong>
  ),
  em: ({ children }) => <em className="text-ink">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-hairline pl-4 text-ink-soft italic">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-hairline">
      <table className="w-full border-collapse text-sm text-ink">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-hairline bg-surface-tint px-3 py-2 text-left font-medium text-ink">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-hairline px-3 py-2 align-top text-ink">
      {children}
    </td>
  ),
};

export const MarkdownRenderer = memo(function MarkdownRenderer({
  source,
}: {
  source: string;
}) {
  return (
    <div className="markdown-body text-[15px] leading-relaxed text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
