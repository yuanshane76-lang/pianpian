import { MarkdownContent } from "./MarkdownContent";

const DELIMITERS = [
  { left: "$$", right: "$$", display: true },
  { left: "\\[", right: "\\]", display: true },
  { left: "\\(", right: "\\)", display: false },
  { left: "$", right: "$", display: false },
] as const;

function isEscaped(text: string, index: number) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function maskTranslationMath(text: string) {
  const replacements: Array<{ source: string; formula: string | null; display: boolean }> = [];
  let masked = "";
  let plainStart = 0;
  let index = 0;
  const appendReplacement = (end: number, replacement: { source: string; formula: string | null; display: boolean }) => {
    masked += text.slice(plainStart, index);
    masked += `[](zhiyan-translation-math:${replacements.length})`;
    replacements.push(replacement);
    plainStart = end;
    index = end;
  };

  while (index < text.length) {
    if (!isEscaped(text, index) && text.startsWith("\\$", index)) {
      appendReplacement(index + 2, { source: "\\$", formula: null, display: false });
      continue;
    }
    const delimiter = isEscaped(text, index) ? undefined : DELIMITERS.find((item) => text.startsWith(item.left, index));
    if (!delimiter) {
      index += 1;
      continue;
    }
    const formulaStart = index + delimiter.left.length;
    let formulaEnd = formulaStart;
    while (formulaEnd < text.length &&
      (isEscaped(text, formulaEnd) || !text.startsWith(delimiter.right, formulaEnd))) formulaEnd += 1;
    if (formulaEnd === text.length) break;
    const end = formulaEnd + delimiter.right.length;
    appendReplacement(end, {
      source: text.slice(index, end),
      formula: text.slice(formulaStart, formulaEnd),
      display: delimiter.display,
    });
  }

  masked += text.slice(plainStart);
  return { masked, replacements };
}

export function TranslationContent({ text }: { text: string }) {
  const { masked, replacements } = maskTranslationMath(text);
  return <div className="translation-content"><MarkdownContent text={masked} mathReplacements={replacements} /></div>;
}
