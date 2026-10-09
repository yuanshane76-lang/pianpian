import { useEffect, useState } from "react";
import { Expand, X } from "lucide-react";
import { loadImageAsset } from "../../services/originalPdf";
import type { DocumentBlock } from "../../domain/documentBlocks";

export function FigurePreview({ originalId, block, onOriginal }: {
  originalId?: string; block: DocumentBlock; onOriginal: (page: number) => void;
}) {
  const [source, setSource] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setSource(""); setError("");
    if (originalId && block.assetPath) void loadImageAsset(originalId, block.assetPath)
      .then((value) => { if (active) setSource(value); })
      .catch(() => { if (active) setError("此预览暂不可用，请查看原页"); });
    return () => { active = false; };
  }, [originalId, block.assetPath]);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);
  return <figure id={`pdf-block-${block.id}`} className="paper-figure">
    {source ? <button type="button" className="figure-image-button" aria-label="放大图表" onClick={() => setExpanded(true)}><img src={source} alt={block.caption || block.text || `第 ${block.pageNumber} 页图表`} loading="lazy" /><Expand size={17} /></button>
      : <p className="muted-copy">{error || (block.assetPath ? "正在加载图表…" : "此内容可在原始 PDF 中完整查看")}</p>}
    <figcaption>{block.caption || block.text}</figcaption>
    <button className="text-button" type="button" onClick={() => onOriginal(block.pageNumber)}>查看第 {block.pageNumber} 页原文</button>
    {expanded ? <div className="figure-overlay" role="dialog" aria-modal="true" aria-label="图表放大预览" onClick={() => setExpanded(false)}>
      <button autoFocus className="figure-close icon-button" aria-label="关闭图表预览" onClick={() => setExpanded(false)}><X size={22} /></button>
      <img src={source} alt={block.caption || "论文图表"} onClick={(event) => event.stopPropagation()} />
    </div> : null}
  </figure>;
}
