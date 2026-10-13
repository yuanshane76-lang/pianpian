import { AlertCircle, LoaderCircle, Settings2, RotateCcw } from "lucide-react";
import type { PaperRecord } from "../../domain/library";
import { getLibraryPreparation, type PaperPipelineState } from "../../domain/pipeline";

export function PaperPreparation({ paper, pipeline, configured, onStart, compact = false }: {
  paper: PaperRecord;
  pipeline?: PaperPipelineState;
  configured: boolean;
  onStart: () => void;
  compact?: boolean;
}) {
  const { active, failed, percent, detail, action } = getLibraryPreparation(paper, pipeline, configured);
  return (
    <div className={`${compact ? "paper-row-progress" : "library-detail-progress"} ${failed ? "is-failed" : active ? "is-active" : "is-waiting"}`}>
      <div className={compact ? "paper-row-progress-heading" : "library-detail-progress-heading"}>
        <span className="paper-preparation-message">
          {!compact && (failed ? <AlertCircle size={16} /> : active ? <LoaderCircle size={16} className="is-spinning" /> : <Settings2 size={16} />)}
          <span>{detail}</span>
        </span>
        <span>{percent === undefined ? active ? "处理中" : "未完成" : `${percent}% 页面`}</span>
      </div>
      <div className={`paper-row-progress-track ${active && percent === undefined ? "is-indeterminate" : ""}`}
        role="progressbar" aria-label={`${paper.title} MinerU 解析进度`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
        aria-valuetext={detail}>
        <span style={active && percent === undefined ? undefined : { transform: `scaleX(${(percent ?? 0) / 100})` }} />
      </div>
      {!compact && <p className="paper-preparation-hint">解析结果、资源和坐标准备完成后，将解锁「打开阅读」。</p>}
      {action && <button className={compact ? "paper-row-progress-action" : "secondary-button compact"}
        aria-label={`处理论文：${paper.title}`} type="button" onClick={(event) => {
          event.stopPropagation();
          onStart();
        }}>
        {!compact && (configured ? <RotateCcw size={14} /> : <Settings2 size={14} />)}
        {action}
      </button>}
    </div>
  );
}
