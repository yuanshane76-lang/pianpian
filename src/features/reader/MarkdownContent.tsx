import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { remarkMathRendering } from "./markdownMath";
import { renderMathHtml } from "./mathRendering";

export function MarkdownContent({ text }: { text: string }) {
  return <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkMathRendering]} skipHtml
    components={{
      span: ({ node, children }) => {
        const properties = node?.properties;
        if (properties && typeof properties["data-math-literal"] === "string") {
          const formula = String(properties["data-math-formula"] ?? "");
          const html = formula ? renderMathHtml(formula, properties["data-math-display"] === true) : null;
          const className = Array.isArray(properties.className) ? properties.className.join(" ") : String(properties.className);
          return html === null ? <span>{properties["data-math-literal"]}</span>
            : <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
        }
        return <span>{children}</span>;
      },
      a: ({ children }) => <span className="markdown-link">{children}</span>,
      img: ({ alt }) => <span>{alt}</span>,
      table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>,
    }}>{text}</ReactMarkdown></div>;
}
