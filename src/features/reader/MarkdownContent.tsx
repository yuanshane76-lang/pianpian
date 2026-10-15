import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { useRef } from "react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { remarkMathRendering } from "./markdownMath";
import { renderMathHtml } from "./mathRendering";
import { citationRehype, citationRemark, type MarkdownCitation } from "./markdownCitations";

export function MarkdownContent({ text, citations = [], onCitation }: {
  text: string; citations?: MarkdownCitation[]; onCitation?: (blockId: string) => void;
}) {
  const numbering = useRef({ text: "", numbers: new Map<string, number>() });
  // Appending streamed Markdown must not renumber a source already shown.
  if (!text.startsWith(numbering.current.text)) numbering.current = { text, numbers: new Map() };
  numbering.current.text = text;
  return <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkMathRendering, citationRemark(citations)]} skipHtml
    rehypePlugins={[citationRehype(citations, numbering.current.numbers)]}
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
      a: ({ node, children, href }) => {
        const citation = href?.match(/^zhiyan-citation:(\d+)$/);
        const source = citation ? citations[Number(citation[1])] : undefined;
        const number = Number(node?.properties["data-citation-number"]);
        return source && onCitation && Number.isInteger(number) && number > 0 ? <button type="button" className="research-inline-citation"
          title="查看原文"
          aria-label={`查看引用 ${number} 的原文`}
          onClick={() => onCitation(source.blockId)}>{children}</button> : <span className="markdown-link">{children}</span>;
      },
      img: ({ alt }) => <span>{alt}</span>,
      table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>,
    }}>{text}</ReactMarkdown></div>;
}
