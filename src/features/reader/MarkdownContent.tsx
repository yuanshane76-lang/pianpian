import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { remarkMathRendering } from "./markdownMath";
import { renderMathHtml } from "./mathRendering";
import { citationRemark, type MarkdownCitation } from "./markdownCitations";

export function MarkdownContent({ text, citations = [], onCitation }: {
  text: string; citations?: MarkdownCitation[]; onCitation?: (blockId: string) => void;
}) {
  return <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkMathRendering, citationRemark(citations)]} skipHtml
    urlTransform={(url) => /^zhiyan-citation:\d+$/.test(url) ? url : defaultUrlTransform(url)}
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
      a: ({ children, href }) => {
        const citation = href?.match(/^zhiyan-citation:(\d+)$/);
        const source = citation ? citations[Number(citation[1])] : undefined;
        return source && onCitation ? <button type="button" className="research-inline-citation"
          title={source.excerpt || `${source.label} · 查看原文`} aria-label={`查看引用：${source.label}`}
          onClick={() => onCitation(source.blockId)}>{children}</button> : <span className="markdown-link">{children}</span>;
      },
      img: ({ alt }) => <span>{alt}</span>,
      table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>,
    }}>{text}</ReactMarkdown></div>;
}
