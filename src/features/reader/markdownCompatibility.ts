type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  data?: { hProperties?: Record<string, unknown> };
  children?: MarkdownNode[];
};

const INLINE_TAG = /^<(sup|sub|i|b)>([^<>]*)<\/\1>$/i;
const INLINE_TAGS = /<(sup|sub|i|b)>([^<>]*)<\/\1>/gi;
const INLINE_TAG_OPEN = /^<(sup|sub|i|b)>$/i;
const INLINE_TAG_CLOSE = /^<\/(sup|sub|i|b)>$/i;
const WHITESPACE_BEFORE_EMPHASIS_CLOSE = /(\*\*|__)([^\r\n]+?)\s+\1/g;

function safeInlineNode(tagName: string, content: string): MarkdownNode {
  const children = [{ type: "text", value: content }];
  if (tagName === "b") return { type: "strong", children };
  if (tagName === "i") return { type: "emphasis", children };
  return {
    type: "link",
    url: `zhiyan-inline:${tagName}`,
    data: { hProperties: { "data-inline-tag": tagName } },
    children,
  };
}

function repairEmphasis(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let offset = 0;
  for (const match of value.matchAll(WHITESPACE_BEFORE_EMPHASIS_CLOSE)) {
    if (match.index === undefined) continue;
    if (match.index > offset) nodes.push({ type: "text", value: value.slice(offset, match.index) });
    nodes.push({ type: "strong", children: [{ type: "text", value: match[2].trimEnd() }] });
    offset = match.index + match[0].length;
  }
  if (offset < value.length || !nodes.length) nodes.push({ type: "text", value: value.slice(offset) });
  return nodes;
}

function normalizeText(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let offset = 0;
  for (const match of value.matchAll(INLINE_TAGS)) {
    if (match.index === undefined) continue;
    if (match.index > offset) nodes.push(...repairEmphasis(value.slice(offset, match.index)));
    nodes.push(safeInlineNode(match[1].toLowerCase(), match[2]));
    offset = match.index + match[0].length;
  }
  if (offset < value.length || !nodes.length) nodes.push(...repairEmphasis(value.slice(offset)));
  return nodes;
}

/** Render only a small inert subset of inline tags; all other raw HTML stays disabled. */
export function remarkMarkdownCompatibility() {
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (!node.children || ["code", "inlineCode", "link", "linkReference", "math", "inlineMath"].includes(node.type)) return;
      const children: MarkdownNode[] = [];
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        if (child.type === "html" && typeof child.value === "string") {
          const standalone = INLINE_TAG.exec(child.value);
          if (standalone) {
            children.push(safeInlineNode(standalone[1].toLowerCase(), standalone[2]));
            continue;
          }
          const opening = INLINE_TAG_OPEN.exec(child.value);
          const content = node.children[index + 1];
          const closing = node.children[index + 2];
          const closingMatch = closing?.type === "html" && typeof closing.value === "string"
            ? INLINE_TAG_CLOSE.exec(closing.value) : null;
          if (opening && content?.type === "text" && typeof content.value === "string" &&
            closingMatch && closingMatch[1].toLowerCase() === opening[1].toLowerCase()) {
            children.push(safeInlineNode(opening[1].toLowerCase(), content.value));
            index += 2;
            continue;
          }
          children.push({ type: "text", value: child.value });
          continue;
        }
        if (child.type === "text" && typeof child.value === "string") {
          children.push(...normalizeText(child.value));
          continue;
        }
        visit(child);
        children.push(child);
      }
      node.children = children;
    }
    visit(tree);
  };
}
