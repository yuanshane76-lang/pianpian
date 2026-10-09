export interface PdfTextItem {
  str: string;
  transform: ArrayLike<number>;
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

function baseline(item: PdfTextItem): number | null {
  const value = item.transform[5];
  return typeof value === "number" ? value : null;
}

function startX(item: PdfTextItem): number | null {
  const value = item.transform[4];
  return typeof value === "number" ? value : null;
}

function fontSize(item: PdfTextItem): number {
  const scale = Math.abs(item.transform[0] ?? 0);
  return scale || Math.abs(item.height ?? 0) || 10;
}

function normalizeLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function groupPdfTextItemsIntoLines(items: PdfTextItem[]): string[] {
  const lines: string[] = [];
  let current: PdfTextItem[] = [];
  let currentBaseline: number | null = null;

  function flush() {
    const text = normalizeLine(current.map((item) => item.str).join(""));
    if (text) lines.push(text);
    current = [];
    currentBaseline = null;
  }

  for (const item of items) {
    const text = item.str ?? "";
    if (!text) {
      if (item.hasEOL) flush();
      continue;
    }

    const itemBaseline = baseline(item);
    const size = fontSize(item);
    const baselineChanged =
      currentBaseline !== null &&
      itemBaseline !== null &&
      Math.abs(currentBaseline - itemBaseline) > Math.max(2, size * 0.55);

    if (baselineChanged) flush();
    if (current.length === 0) currentBaseline = itemBaseline;
    current.push(item);

    if (item.hasEOL) flush();
  }

  flush();
  return lines;
}

// PDF line endings describe layout. Preserve paragraph boundaries separately.
export function groupPdfTextItemsIntoParagraphs(items: PdfTextItem[]): string[] {
  const lines: Array<{ text: string; x: number; y: number; size: number }> = [];
  let current: PdfTextItem[] = [];
  function flush() {
    if (!current.length) return;
    const first = current[0];
    const text = normalizeLine(current.map((item) => item.str).join(""));
    if (text) lines.push({ text, x: startX(first) ?? 0, y: baseline(first) ?? 0, size: fontSize(first) });
    current = [];
  }
  for (const item of items) {
    if (current.length && Math.abs((baseline(current[0]) ?? 0) - (baseline(item) ?? 0)) > Math.max(2, fontSize(item) * .55)) flush();
    if (item.str) current.push(item);
    if (item.hasEOL) flush();
  }
  flush();
  const result: string[] = [];
  lines.forEach((line, index) => {
    const previous = lines[index - 1];
    if (previous && (
      Math.abs(line.y - previous.y) > Math.max(line.size, previous.size) * 1.8 ||
      Math.abs(line.size - previous.size) > 1.5 ||
      line.y > previous.y + 2 ||
      (line.x > previous.x + 8 && /[.!?。！？]$/.test(previous.text))
    )) result.push("");
    result.push(line.text);
  });
  return result;
}
