import { AlertTriangle, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PaperRecord } from "../../domain/library";
import { formatRadarAuthors, type RadarCandidate } from "../../domain/paperRadar";
import { DEFAULT_RADAR_LIMIT, loadRelatedPapers, type RadarResult } from "../../services/paperRadar";

type RadarPaper = Pick<PaperRecord, "title" | "doi">;

interface Props {
  paper: RadarPaper;
  library?: RadarPaper[];
}

function candidateLink(candidate: RadarCandidate): string | undefined {
  if (candidate.doi) return `https://doi.org/${candidate.doi}`;
  return candidate.url;
}

function candidateMeta(candidate: RadarCandidate): string {
  const parts = [formatRadarAuthors(candidate.authors), candidate.year ? String(candidate.year) : "年份未知"];
  if (candidate.venue) parts.push(candidate.venue);
  return parts.join(" · ");
}

export function PaperRadar({ paper, library }: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [result, setResult] = useState<RadarResult | null>(null);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const libraryRef = useRef<RadarPaper[]>(library ?? []);
  libraryRef.current = library ?? [];

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setError("");
    void loadRelatedPapers({ paper, library: libraryRef.current, limit: DEFAULT_RADAR_LIMIT })
      .then((next) => {
        if (!active) return;
        setResult(next);
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "检索失败，请稍后重试。");
        setStatus("error");
      });
    return () => { active = false; };
  }, [paper.title, paper.doi, reloadToken]);

  function refresh() {
    setReloadToken((current) => current + 1);
  }

  return <div className="radar-panel">
    <div className="section-heading">
      <h2>相似论文</h2>
      <button className="assistant-tool-button" type="button" onClick={refresh} disabled={status === "loading"} title="重新检索" aria-label="重新检索相似论文">
        <RefreshCw size={14} className={status === "loading" ? "spin" : undefined} />
      </button>
    </div>
    {status === "loading" ? <p className="radar-status" role="status"><LoaderCircle className="spin" size={14} />正在检索相似工作…</p> : null}
    {status === "error" ? <div className="radar-error" role="alert">
      <AlertTriangle size={15} />
      <span>{error}</span>
      <button type="button" className="text-button" onClick={refresh}><RefreshCw size={13} />重试</button>
    </div> : null}
    {status === "ready" && result ? <>
      <p className="radar-summary" aria-live="polite">
        {result.candidates.length ? `找到 ${result.candidates.length} 篇可能相关的论文` : "这次没有找到新的相似工作"}
      </p>
      {result.candidates.length ? <ol className="radar-list">
        {result.candidates.map((candidate, index) => {
          const link = candidateLink(candidate);
          return <li className="radar-card" key={candidate.id}>
            <div className="radar-card-head">
              <span className="radar-rank">{index + 1}</span>
              <strong className="radar-candidate-title">{candidate.title}</strong>
            </div>
            <p className="radar-meta">{candidateMeta(candidate)}</p>
            {candidate.abstract ? <p className="radar-abstract">{candidate.abstract}</p> : null}
            <div className="radar-actions">
              <span className="radar-citation">{typeof candidate.citationCount === "number" ? `被引 ${candidate.citationCount}` : "引用数据未知"}</span>
              {link ? <a className="text-button" href={link} target="_blank" rel="noreferrer noopener">查看原文<ExternalLink size={12} /></a> : null}
            </div>
          </li>;
        })}
      </ol> : null}
      <p className="radar-source">来源 {result.source}{result.cached ? "（本地缓存）" : ""} · 仅元数据，未核验全文</p>
    </> : null}
  </div>;
}
