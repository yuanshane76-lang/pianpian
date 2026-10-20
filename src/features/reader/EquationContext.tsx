import { LoaderCircle, Sigma } from "lucide-react";
import { useMemo } from "react";
import type { DocumentBlock } from "../../domain/documentBlocks";
import { previewEquationReading, type EquationReading } from "../../domain/learning";
import { MarkdownContent } from "./MarkdownContent";
import { TranslationContent } from "./TranslationContent";

function equationSource(text: string) {
  const value = text.trim();
  if (value.startsWith("$$") && value.endsWith("$$")) return value;
  if (value.startsWith("\\[") && value.endsWith("\\]")) return `$$${value.slice(2, -2)}$$`;
  if (value.startsWith("\\(") && value.endsWith("\\)")) return `$${value.slice(2, -2)}$`;
  if (value.startsWith("$") && value.endsWith("$")) return value;
  return `$$${value}$$`;
}

export function EquationContext({ block, reading, streamingText, busy, loading, aiAvailable, onRead, onOpenSettings }: {
  block: DocumentBlock;
  reading: EquationReading | null;
  streamingText: string;
  busy: boolean;
  loading: boolean;
  aiAvailable: boolean;
  onRead: () => void;
  onOpenSettings: () => void;
}) {
  const source = useMemo(() => equationSource(block.text), [block.text]);
  const displayed = loading ? previewEquationReading(streamingText) : reading;
  return <div className="equation-context">
    <div className="equation-source" aria-label="公式原文">
      <TranslationContent text={source} />
    </div>
    <div className="context-actions">
      <button className="secondary-button compact" type="button" disabled={busy}
        onClick={aiAvailable ? onRead : onOpenSettings}>
        {loading ? <LoaderCircle className="spin" size={14} /> : <Sigma size={14} />}
        {aiAvailable ? "解读公式" : "配置 AI 服务"}
      </button>
    </div>
    {loading ? <p className="equation-reading-progress" role="status"><LoaderCircle className="spin" size={14} />正在解读公式…</p> : null}
    {displayed ? <div className="assistant-equation-reading" aria-live="polite" aria-busy={loading}>
      {displayed.summary ? <><strong>公式含义</strong><MarkdownContent text={displayed.summary} /></> : null}
      {displayed.variables.length ? <><strong>符号和变量</strong><ul>{displayed.variables.map((variable, index) => <li key={index}><MarkdownContent text={variable} /></li>)}</ul></> : null}
      {displayed.role ? <><strong>论文中的作用</strong><MarkdownContent text={displayed.role} /></> : null}
      {displayed.caveats.length ? <><strong>注意事项</strong><ul>{displayed.caveats.map((caveat, index) => <li key={index}><MarkdownContent text={caveat} /></li>)}</ul></> : null}
    </div> : null}
  </div>;
}
