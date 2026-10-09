export type DocumentBlockKind = "heading" | "paragraph" | "image" | "table" | "equation";

export interface ExtractedPage {
  pageNumber: number;
  lines: string[];
}

export interface DocumentBlock {
  id: string;
  pageNumber: number;
  order: number;
  kind: DocumentBlockKind;
  text: string;
  assetPath?: string;
  caption?: string;
  /** Top-left page fractions [x0, y0, x1, y1], all in 0–1. */
  bbox?: [number, number, number, number];
  pageWidth?: number;
  pageHeight?: number;
}

function isHeading(line: string): boolean {
  const normalized = line.trim();
  return (
    /^(abstract|摘要|introduction|background|method|methods|结果|结论|references?)$/i.test(
      normalized,
    ) ||
    /^\d+(?:\.\d+)*[.)]?\s+\S+/.test(normalized)
  );
}

function hashText(value: string): string {
  let hash = 1469598103934665603n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function createDocumentBlocks(pages: ExtractedPage[]): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  const orderedPages = [...pages].sort((left, right) => left.pageNumber - right.pageNumber);

  for (const page of orderedPages) {
    let pageOrder = 0;
    let paragraph = "";
    function add(text: string, kind: DocumentBlockKind) {
      if (!text) return;
      pageOrder += 1;
      blocks.push({
        id: `p${String(page.pageNumber).padStart(3, "0")}-b${String(pageOrder).padStart(3, "0")}`,
        pageNumber: page.pageNumber,
        order: blocks.length,
        kind,
        text,
      });
    }
    function flush() {
      add(paragraph, "paragraph");
      paragraph = "";
    }
    for (const rawLine of page.lines) {
      const text = rawLine.replace(/\s+/g, " ").trim();
      if (!text) { flush(); continue; }
      if (isHeading(text)) { flush(); add(text, "heading"); continue; }
      if (paragraph.endsWith("-") && /^[a-z]/.test(text)) paragraph = paragraph.slice(0, -1) + text;
      else paragraph += `${paragraph && !/[\u3400-\u9fff]$/.test(paragraph) ? " " : ""}${text}`;
    }
    flush();
  }

  return blocks;
}

export function getDocumentBlockSignature(block: Pick<DocumentBlock, "id" | "pageNumber" | "kind" | "text">): string {
  return hashText([block.id, block.pageNumber, block.kind, block.text].join("\u001f"));
}

function normalizeContent(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function getDocumentContentSignature(
  block: Pick<DocumentBlock, "kind" | "text">,
): string {
  return hashText([block.kind, normalizeContent(block.text)].join("\u001f"));
}

export function getDocumentSourceSignature(
  blocks: Array<Pick<DocumentBlock, "id" | "pageNumber" | "kind" | "text">>,
): string {
  return hashText(blocks.map((block) => getDocumentBlockSignature(block)).join("\u001e"));
}

export function getDocumentContentSourceSignature(
  blocks: Array<Pick<DocumentBlock, "kind" | "text">>,
): string {
  return hashText(blocks.map((block) => getDocumentContentSignature(block)).join("\u001e"));
}
