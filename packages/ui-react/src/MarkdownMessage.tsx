import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

export function MarkdownMessage({
  children,
  tone = "assistant",
}: {
  children: string;
  tone?: "assistant" | "user";
}) {
  return (
    <div className={`browser-acp-markdown browser-acp-markdown-${tone}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ className, children, ...props }) {
            if (!className) {
              return (
                <code className="browser-acp-inline-code" {...props}>
                  {children}
                </code>
              );
            }

            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          a({ ...props }) {
            return <a target="_blank" rel="noreferrer" {...props} />;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
