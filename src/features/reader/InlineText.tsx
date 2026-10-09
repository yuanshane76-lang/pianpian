import type { ReactNode } from "react";

// MinerU may encode superscripts in text. Recognize only a tiny inert subset.
export function InlineText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  const pattern = /<(sup|sub|i|b)>([^<]*)<\/\1>/gi;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    nodes.push(text.slice(offset, match.index));
    const key = match.index;
    const content = match[2];
    const tag = match[1].toLowerCase();
    nodes.push(tag === "sup" ? <sup key={key}>{content}</sup> : tag === "sub" ? <sub key={key}>{content}</sub> : tag === "i" ? <i key={key}>{content}</i> : <b key={key}>{content}</b>);
    offset = match.index! + match[0].length;
  }
  nodes.push(text.slice(offset));
  return <>{nodes}</>;
}
