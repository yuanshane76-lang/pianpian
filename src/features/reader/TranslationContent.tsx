import "katex/dist/katex.min.css";
import { useLayoutEffect, useRef } from "react";
import { renderMathHtml } from "./mathRendering";

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

function renderTranslation(text: string) {
  const fragment = document.createDocumentFragment();
  let plainStart = 0;
  let index = 0;
  while (index < text.length) {
    const delimiter = isEscaped(text, index) ? undefined : DELIMITERS.find((item) => text.startsWith(item.left, index));
    if (!delimiter) { index += 1; continue; }
    const formulaStart = index + delimiter.left.length;
    let formulaEnd = formulaStart;
    // Delimiter recovery must not depend on balanced braces in malformed TeX.
    while (formulaEnd < text.length && (isEscaped(text, formulaEnd) || !text.startsWith(delimiter.right, formulaEnd))) formulaEnd += 1;
    if (formulaEnd === text.length) break;
    if (index > plainStart) fragment.append(document.createTextNode(text.slice(plainStart, index)));
    const end = formulaEnd + delimiter.right.length;
    const source = text.slice(index, end);
    const wrapper = document.createElement("span");
    const html = renderMathHtml(text.slice(formulaStart, formulaEnd), delimiter.display);
    if (html === null) {
      fragment.append(document.createTextNode(source));
    } else {
      wrapper.className = delimiter.display ? "translation-math translation-math-display" : "translation-math";
      wrapper.innerHTML = html;
      fragment.append(wrapper);
    }
    plainStart = end;
    index = end;
  }
  if (plainStart < text.length) fragment.append(document.createTextNode(text.slice(plainStart)));
  return fragment;
}

export function TranslationContent({ text }: { text: string }) {
  const contentRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    // React owns the host, while the renderer owns its children.
    content.replaceChildren(renderTranslation(text));
  }, [text]);

  return <p ref={contentRef} className="translation-content" />;
}
