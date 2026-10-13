import { ChartNoAxesCombined, Expand, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { DocumentBlock } from "../../domain/documentBlocks";
import { getDocumentVisualSignature } from "../../domain/documentBlocks";
import { previewChartReading, type ChartReading } from "../../domain/learning";
import { loadChartImage } from "../../services/chartImage";
import { MarkdownContent } from "./MarkdownContent";

export function ChartContext({ originalId, block, reading, streamingText, busy, loading, aiAvailable, onRead, onOpenSettings }: {
  originalId?: string; block: DocumentBlock; reading: ChartReading | null; busy: boolean;
  streamingText: string; loading: boolean;
  aiAvailable: boolean; onRead: () => void; onOpenSettings: () => void;
}) {
  const [source, setSource] = useState("");
  const [imageError, setImageError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const signature = getDocumentVisualSignature(block);
  const displayed = loading ? previewChartReading(streamingText) : reading;
  useEffect(() => {
    let active = true;
    setSource(""); setImageError(""); setExpanded(false);
    void loadChartImage(originalId, block).then((value) => { if (active) setSource(value); })
      .catch((error) => { if (active) setImageError(error?.message || "图表预览暂不可用"); });
    return () => { active = false; };
  }, [originalId, signature]);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);
  return <div className="chart-context">
    <figure className="assistant-chart-preview">
      {source ? <button className="figure-image-button" type="button" aria-label="放大选中图表" title="放大图表" onClick={() => setExpanded(true)}>
        <img src={source} alt={block.caption || `第 ${block.pageNumber} 页${block.kind === "table" ? "表格" : "图表"}`} /><Expand size={16} />
      </button> : <p className="muted-copy" role="status">{imageError || "正在加载图表原图…"}</p>}
      {block.caption ? <figcaption>{block.caption}</figcaption> : null}
    </figure>
    <div className="context-actions"><button className="secondary-button compact" type="button" disabled={busy}
      onClick={aiAvailable ? onRead : onOpenSettings}>{loading ? <LoaderCircle className="spin" size={14} /> : <ChartNoAxesCombined size={14} />}{aiAvailable ? "读图表" : "配置 AI 服务"}</button></div>
    {loading ? <p className="chart-reading-progress" role="status"><LoaderCircle className="spin" size={14} />正在解读图表…</p> : null}
    {displayed ? <div className="assistant-chart-reading" aria-live="polite" aria-busy={loading}>
      {displayed.summary ? <><strong>比较对象</strong><MarkdownContent text={displayed.summary} /></> : null}
      {displayed.encoding ? <><strong>指标读法</strong><MarkdownContent text={displayed.encoding} /></> : null}
      {displayed.findings.length ? <><strong>关键发现</strong><ul>{displayed.findings.map((finding, index) => <li key={index}><MarkdownContent text={finding} /></li>)}</ul></> : null}
      {displayed.role ? <><strong>论文中的作用</strong><MarkdownContent text={displayed.role} /></> : null}
      {displayed.caveats.length ? <><strong>注意事项</strong><ul>{displayed.caveats.map((caveat, index) => <li key={index}><MarkdownContent text={caveat} /></li>)}</ul></> : null}
    </div> : null}
    {expanded ? <div className="figure-overlay" role="dialog" aria-modal="true" aria-label="选中图表放大预览" onClick={() => setExpanded(false)}>
      <button autoFocus className="figure-close icon-button" type="button" aria-label="关闭图表预览" onClick={() => setExpanded(false)}><X size={22} /></button>
      <img src={source} alt={block.caption || "论文图表"} onClick={(event) => event.stopPropagation()} />
    </div> : null}
  </div>;
}
