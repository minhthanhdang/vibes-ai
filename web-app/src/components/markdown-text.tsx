import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-current/10 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-md bg-current/10 p-2 font-mono text-xs last:mb-0">
      {children}
    </pre>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2 opacity-80 hover:opacity-100"
    >
      {children}
    </a>
  ),
  h1: ({ children }) => <p className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</p>,
  h2: ({ children }) => <p className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</p>,
  h3: ({ children }) => <p className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</p>,
  h4: ({ children }) => <p className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</p>,
  h5: ({ children }) => <p className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</p>,
  h6: ({ children }) => <p className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</p>,
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-current/20 pl-2 opacity-80 last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-2 border-current/10" />,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-current/10 px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-current/10 px-2 py-1">{children}</td>,
};

export function MarkdownText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
