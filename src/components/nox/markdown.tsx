"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Markdown â€” renders AI responses with GFM (tables, strikethrough, task lists)
// + syntax-highlighted code blocks with copy buttons.
//
// Used inside every MessageBubble's content area. The `nox-prose` class on the
// parent controls spacing; this component handles block elements + code.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface MarkdownProps {
  content: string;
  className?: string;
}

export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Code blocks â€” render with a copy button + monospace styling.
          pre({ children }) {
            return <CodeBlock>{children}</CodeBlock>;
          },
          // Inline code â€” small monospace with background.
          code({ className: cls, children, ...props }) {
            // If it's inside a <pre>, the CodeBlock wrapper handles styling.
            // Otherwise it's inline code.
            const isInline = !cls;
            if (isInline) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded bg-muted/60 font-mono text-[0.85em]"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={cls} {...props}>
                {children}
              </code>
            );
          },
          // Links open in a new tab.
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                {children}
              </a>
            );
          },
          // Tables â€” horizontal scroll on small screens.
          table({ children }) {
            return (
              <div className="overflow-x-auto nox-scroll my-3">
                <table className="w-full text-xs border-collapse">{children}</table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="border border-border bg-muted/40 px-2 py-1 text-left font-semibold">
                {children}
              </th>
            );
          },
          td({ children }) {
            return <td className="border border-border px-2 py-1">{children}</td>;
          },
          // Blockquotes â€” left border accent.
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-primary/40 pl-3 my-2 text-muted-foreground italic">
                {children}
              </blockquote>
            );
          },
          // Lists â€” tighter spacing.
          ul({ children }) {
            return <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>;
          },
          // Headings â€” scaled down for chat context.
          h1({ children }) {
            return <h1 className="text-lg font-semibold mt-3 mb-1.5">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-base font-semibold mt-3 mb-1.5">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>;
          },
          // Paragraphs â€” tight.
          p({ children }) {
            return <p className="my-1.5 leading-relaxed">{children}</p>;
          },
          // Horizontal rule.
          hr() {
            return <hr className="my-3 border-border" />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// CodeBlock â€” wraps <pre> with a copy button + dark background.
function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false);

  // Extract raw text from the children for the copy button.
  const getText = () => {
    if (typeof children === "string") return children;
    // children is typically an array with a <code> element; extract its text.
    const extract = (node: React.ReactNode): string => {
      if (typeof node === "string") return node;
      if (typeof node === "number") return String(node);
      if (Array.isArray(node)) return node.map(extract).join("");
      if (React.isValidElement(node)) {
        return extract((node.props as { children?: React.ReactNode }).children);
      }
      return "";
    };

    return extract(children);
  };

  const copy = () => {
    navigator.clipboard.writeText(getText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-2.5 rounded-lg border border-border bg-[#0d0b14] overflow-hidden">
      <button
        onClick={copy}
        className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-muted/40 hover:bg-muted/70 text-muted-foreground hover:text-foreground transition"
        title="Copy code"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
      <pre className="p-3 pr-10 overflow-x-auto nox-scroll text-xs font-mono leading-relaxed text-foreground/90">
        {children}
      </pre>
    </div>
  );
}






