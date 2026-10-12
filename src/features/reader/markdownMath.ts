import type { Root, RootContent } from "mdast";
import type { VFile } from "vfile";

/** Preserve source delimiters so unfinished streamed blocks and invalid math stay readable. */
export function remarkMathRendering() {
  return (tree: Root, file: VFile) => {
    const source = String(file.value);
    function visit(node: Root | RootContent) {
      if (node.type === "math" || node.type === "inlineMath") {
        const literal = source.slice(node.position?.start.offset, node.position?.end.offset);
        const display = node.type === "math";
        // CommonMark-style math fences also parse at EOF. Do not render before the closing fence.
        const lines = literal.split(/\r?\n/);
        const fence = /^\s*(\${2,})/.exec(lines[0])?.[1];
        const closingFence = /^(?:[ \t]*>[ \t]?)*[ \t]*(\${2,})[ \t]*$/.exec(lines.at(-1)!)?.[1];
        const closed = !display || (lines.length > 1 && Boolean(fence) &&
          (closingFence?.length ?? 0) >= fence!.length);
        node.data = {
          hName: "span",
          hProperties: {
            className: display ? ["markdown-math", "markdown-math-display"] : ["markdown-math"],
            "data-math-formula": closed ? node.value : "",
            "data-math-display": display,
            "data-math-literal": literal,
          },
          hChildren: [],
        };
      } else if ("children" in node) {
        for (const child of node.children) visit(child as RootContent);
      }
    }
    visit(tree);
  };
}
