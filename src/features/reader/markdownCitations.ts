export interface MarkdownCitation { blockId: string; label: string; excerpt?: string }
interface Node { type: string; value?: string; children?: Node[]; url?: string }
export function citationRemark(citations: MarkdownCitation[]) {
  return () => (tree: Node) => {
    const ids = new Map(citations.map((citation, index) => [citation.blockId, index]));
    function visit(node: Node) {
      if (!node.children || ["code", "inlineCode", "link"].includes(node.type)) return;
      node.children = node.children.flatMap((child): Node[] => {
        if (child.type !== "text" || !child.value) { visit(child); return [child]; }
        const parts: Node[] = [];
        let position = 0;
        for (const match of child.value.matchAll(/\[引用:([^\]\r\n]{1,200})\]/g)) {
          const index = ids.get(match[1]);
          if (index === undefined) continue;
          parts.push({ type: "text", value: child.value.slice(position, match.index) });
          parts.push({ type: "link", url: `zhiyan-citation:${index}`, children: [{ type: "text", value: citations[index].label }] });
          position = match.index! + match[0].length;
        }
        parts.push({ type: "text", value: child.value.slice(position) });
        return parts;
      });
    }
    visit(tree);
  };
}
