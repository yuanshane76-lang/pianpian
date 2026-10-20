import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import { useMemo, useRef } from "react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { remarkMathRendering } from "./markdownMath";
import { remarkMarkdownCompatibility } from "./markdownCompatibility";
import { renderMathHtml } from "./mathRendering";
import { citationRehype, citationRemark, type MarkdownCitation } from "./markdownCitations";

export type MarkdownMathReplacement = {
  source: string;
  formula: string | null;
  display: boolean;
};

export function MarkdownContent({ text, citations = [], onCitation, mathReplacements = [] }: {
  text: string;
  citations?: MarkdownCitation[];
  onCitation?: (blockId: string) => void;
  mathReplacements?: MarkdownMathReplacement[];
}) {
  const numbering = useRef({ text: "", numbers: new Map<string, number>() });
  const citationContext = useRef({ citations, onCitation });
  const mathContext = useRef(mathReplacements);
  citationContext.current = { citations, onCitation };
  mathContext.current = mathReplacements;
  // Appending streamed Markdown must not renumber a source already shown.
  if (!text.startsWith(numbering.current.text)) numbering.current = { text, numbers: new Map() };
  numbering.current.text = text;
  // Keep renderer identities stable so closing a toolbar popover does not
  // replace a focused citation between pointer-down and click.
  const components = useMemo<Components>(() => ({
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
        const { citations, onCitation } = citationContext.current;
        const inlineTag = node?.properties["data-inline-tag"];
        if (inlineTag === "sup" || inlineTag === "sub") {
          const Tag = inlineTag;
          return <Tag>{children}</Tag>;
        }
        const translationMath = href?.match(/^zhiyan-translation-math:(\d+)$/);
        if (translationMath) {
          const replacement = mathContext.current[Number(translationMath[1])];
          if (!replacement) return <span>{children}</span>;
          const html = replacement.formula === null ? null : renderMathHtml(replacement.formula, replacement.display);
          if (html === null) return <span>{replacement.source}</span>;
          const className = replacement.display ? "translation-math translation-math-display" : "translation-math";
          return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
        }
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
    }), []);
  return <div className="markdown-content"><ReactMarkdown remarkPlugins={[
    remarkGfm, remarkMath, remarkMathRendering, remarkMarkdownCompatibility, citationRemark(citations),
  ]} skipHtml
    rehypePlugins={[citationRehype(citations, numbering.current.numbers)]}
    urlTransform={(url) => /^zhiyan-(?:citation:\d+|inline:(?:sup|sub)|translation-math:\d+)$/.test(url)
      ? url : defaultUrlTransform(url)}
    components={components}>{text}</ReactMarkdown></div>;
}
