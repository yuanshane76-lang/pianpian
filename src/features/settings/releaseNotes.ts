const BLOCK_TAGS = new Set(["ADDRESS", "ARTICLE", "BLOCKQUOTE", "BR", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "OL", "P", "PRE", "SECTION", "UL"]);

export function formatReleaseNotes(notes: string): string {
  const source = notes.trim();
  if (!source || !/<\/?[a-z][^>]*>/i.test(source) || typeof DOMParser === "undefined") return source;

  const document = new DOMParser().parseFromString(source, "text/html");
  const output: string[] = [];
  function visit(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      output.push(node.textContent || "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as Element;
    if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(element.tagName)) return;
    if (BLOCK_TAGS.has(element.tagName)) output.push("\n");
    if (element.tagName === "LI") output.push("• ");
    for (const child of element.childNodes) visit(child);
    if (BLOCK_TAGS.has(element.tagName)) output.push("\n");
  }
  visit(document.body);
  return output.join("")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
