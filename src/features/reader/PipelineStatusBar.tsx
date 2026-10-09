import { Check, CircleAlert, LoaderCircle, Pause, Play, RotateCcw } from "lucide-react";
import { pipelineStageLabel, type PaperPipelineState } from "../../domain/pipeline";

interface PipelineStatusBarProps {
  state: PaperPipelineState;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
}

export function PipelineStatusBar({ state, onPause, onResume, onRetry }: PipelineStatusBarProps) {
  const busy = ["local-extracting", "mineru-uploading", "mineru-processing", "mineru-downloading", "translating-preview"].includes(state.stage);
  const failed = state.stage === "failed" || state.failedCount > 0;
  return (
    <div className={`pipeline-status-bar ${failed ? "is-error" : ""}`} role="status" aria-live="polite">
      <div className="pipeline-step is-done">
        <Check size={14} />
        <span>原文已保存</span>
      </div>
      <div className={`pipeline-step ${busy ? "is-active" : state.stage === "ready" ? "is-done" : ""}`}>
        {state.stage === "ready" ? <Check size={14} /> : busy ? <LoaderCircle size={14} className="spin" /> : <span className="pipeline-dot" />}
        <span>{pipelineStageLabel(state)}</span>
      </div>
      <div className="pipeline-step pipeline-translation-step">
        <span className="pipeline-translation-count">中文预览 · {state.translatedCount} 段</span>
        {state.queuedCount > 0 ? <small>队列 {state.queuedCount}</small> : null}
        {state.paused ? <small>已暂停</small> : null}
      </div>
      {state.paused ? (
        <button className="pipeline-control" aria-label="继续自动翻译" onClick={onResume} type="button">
          <Play size={13} />继续
        </button>
      ) : state.stage === "translating-preview" ? (
        <button className="pipeline-control" aria-label="暂停自动翻译" onClick={onPause} type="button">
          <Pause size={13} />暂停
        </button>
      ) : null}
      {failed ? (
        <button className="pipeline-control pipeline-retry" aria-label="重试论文处理" onClick={onRetry} type="button">
          {state.error ? <CircleAlert size={13} /> : <RotateCcw size={13} />}重试
        </button>
      ) : null}
    </div>
  );
}
