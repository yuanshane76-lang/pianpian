import { Check, CircleAlert, LoaderCircle, Play, RotateCcw, Settings2 } from "lucide-react";
import { getReaderProgress, type PaperPipelineState, type ReaderProgressContext, type ReaderProgressStep } from "../../domain/pipeline";

interface PipelineStatusBarProps {
  state: PaperPipelineState;
  context: ReaderProgressContext;
  onEnhance: () => void;
  onRetryBasic: () => void;
  onOpenSettings: () => void;
}

export function PipelineStatusBar(props: PipelineStatusBarProps) {
  const progress = getReaderProgress(props.state, props.context);
  const steps = [
    { key: "original", label: "原文阅读", state: progress.original },
    { key: "layout", label: "段落定位", state: progress.layout },
  ];
  function control(step: ReaderProgressStep) {
    if (!step.action) return null;
    const actions = {
      configure: { label: "配置 MinerU", text: "配置", icon: Settings2, run: props.onOpenSettings },
      parse: { label: step.status === "warning" ? "重试论文处理" : "开始或继续段落解析",
        text: step.status === "warning" ? "重新解析" : props.context.mineruPending ? "继续解析" : "开始 MinerU 解析",
        icon: step.status === "warning" ? RotateCcw : Play, run: props.onEnhance },
      "retry-local": { label: "重试正文整理", text: "重试正文整理", icon: RotateCcw, run: props.onRetryBasic },
    };
    const action = actions[step.action];
    const Icon = action.icon;
    return <button className="pipeline-control" aria-label={action.label} onClick={action.run} type="button">
      <Icon size={13} aria-hidden="true" />{action.text}
    </button>;
  }
  return (
    <section className="pipeline-status-bar" aria-label="论文准备进度">
      <ol className="pipeline-steps">
        {steps.map(({ key, label, state: step }, index) => (
          <li className={`pipeline-step is-${step.status}`} key={key}>
            <span className="pipeline-step-marker" aria-hidden="true">
              {step.status === "done" ? <Check size={14} /> : step.status === "active" ? <LoaderCircle size={14} className="spin" />
                : step.status === "warning" ? <CircleAlert size={14} /> : index + 1}
            </span>
            <div className="pipeline-step-copy">
              <div className="pipeline-step-heading"><span className="pipeline-step-label">{label}</span>
                <span className="pipeline-step-detail" role="status" title={step.description}>{step.detail}</span>
              </div>
              {step.status === "active" ? (
                <div className={`pipeline-progress-track ${step.percent === undefined ? "is-indeterminate" : ""}`}
                  role="progressbar" aria-label={`${label}进度`} aria-valuemin={0} aria-valuemax={100}
                  aria-valuenow={step.percent} aria-valuetext={step.detail}>
                  <span style={step.percent === undefined ? undefined : { transform: `scaleX(${step.percent / 100})` }} />
                </div>
              ) : null}
            </div>
            {control(step)}
          </li>
        ))}
      </ol>
    </section>
  );
}
