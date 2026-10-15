import type { PaperCitation } from "../../domain/paperCitations";

export type MarkdownCitation = PaperCitation;
interface Node {
  type: string; value?: string; children?: Node[]; url?: string;
  tagName?: string; properties?: Record<string, unknown>;
  data?: { hProperties: { "data-citation-verified": boolean } };
}
export function citationRemark(citations: MarkdownCitation[]) {
  return () => (tree: Node) => {
    const ids = new Map(citations.map((citation, index) => [citation.blockId, index]));
    function visit(node: Node) {
      if (!node.children || ["code", "inlineCode", "link", "linkReference"].includes(node.type)) return;
      node.children = node.children.flatMap((child): Node[] => {
        if (child.type !== "text" || !child.value) { visit(child); return [child]; }
        const parts: Node[] = [];
        let position = 0;
        for (const match of child.value.matchAll(/\[引用:([^\]\r\n]{1,200})\]/g)) {
          const index = ids.get(match[1]);
          if (index === undefined) continue;
          parts.push({ type: "text", value: child.value.slice(position, match.index) });
          parts.push({ type: "link", url: `zhiyan-citation:${index}`,
            data: { hProperties: { "data-citation-verified": true } },
            children: [{ type: "text", value: match[0] }] });
          position = match.index! + match[0].length;
        }
        parts.push({ type: "text", value: child.value.slice(position) });
        return parts;
      });
    }
    visit(tree);
  };
}

/** Assign numbers after footnotes have been moved to their rendered positions. */
export function citationRehype(citations: MarkdownCitation[], numbers: Map<string, number>) {
  return () => (tree: Node) => {
    function visit(node: Node) {
      const match = node.tagName === "a" && node.properties?.["data-citation-verified"] === true
        ? String(node.properties.href).match(/^zhiyan-citation:(\d+)$/) : null;
      const source = match ? citations[Number(match[1])] : undefined;
      if (source) {
        if (!numbers.has(source.blockId)) numbers.set(source.blockId, numbers.size + 1);
        const number = numbers.get(source.blockId)!;
        node.properties!["data-citation-number"] = number;
        node.children = [{ type: "text", value: `[${number}]` }];
      }
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}
