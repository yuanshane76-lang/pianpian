import { FilePlus2, FileText, Heart, Search } from "lucide-react";
import type { PaperRecord } from "../../domain/library";
import { canOpenPaper, type PaperPipelineState } from "../../domain/pipeline";
import { PaperPreparation } from "./PaperPreparation";

interface PaperListProps {
  papers: PaperRecord[];
  selectedId: string | null;
  query: string;
  errorMessage: string | null;
  onQueryChange: (query: string) => void;
  onImport: (file: File) => Promise<void>;
  onSelect: (paperId: string) => void;
  onToggleFavorite: (paperId: string) => void;
  onStartMineru: (paperId: string) => void;
  pipelineStates: Record<string, PaperPipelineState>;
  mineruConfigured: boolean;
  importing: boolean;
}

export function PaperList({
  papers,
  selectedId,
  query,
  errorMessage,
  onQueryChange,
  onImport,
  onSelect,
  onToggleFavorite,
  onStartMineru,
  pipelineStates,
  mineruConfigured,
  importing,
}: PaperListProps) {
  return (
    <section className="paper-list-panel" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (file && !importing) void onImport(file);
    }}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">文献库</span>
          <h1>文献库</h1>
        </div>
        <div className="paper-list-actions">
          <span className="result-count">{papers.length} 篇</span>
          <label className="import-button">
            <FilePlus2 size={16} />
            <span>{importing ? "正在保存 PDF…" : "导入论文"}</span>
            <input
              accept="application/pdf,.pdf"
              hidden
              disabled={importing}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImport(file);
                event.currentTarget.value = "";
              }}
              type="file"
            />
          </label>
        </div>
      </div>

      <label className="search-field">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">搜索文献</span>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索标题、作者或标签"
          type="search"
        />
      </label>

      <p className="library-import-hint">导入后自动上传到 MinerU 解析，完成后即可阅读。</p>

      {errorMessage ? (
        <p className="import-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className="paper-list" aria-label="论文列表">
        {papers.length === 0 ? (
          <div className="empty-list">
            <FileText size={24} />
            <p>暂时没有文献</p>
            <span>调整搜索条件，或导入 PDF 开始阅读。</span>
          </div>
        ) : (
          papers.map((paper) => {
              const ready = canOpenPaper(paper, pipelineStates[paper.id]);
              return (
            <article
              className={`paper-row ${selectedId === paper.id ? "is-selected" : ""}`}
              key={paper.id}
              onClick={() => onSelect(paper.id)}
              onKeyDown={(event) => {
                if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  onSelect(paper.id);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="paper-icon" aria-hidden="true">
                <FileText size={18} />
              </div>
              <div className="paper-row-copy">
                <h2>{paper.title}</h2>
                <p>{paper.authors.length ? paper.authors.join(", ") : "作者待补充"}</p>
                <div className="paper-meta">
                  <span>{paper.year ?? "未标注年份"}</span>
                  <span>{paper.blocks} 个阅读块</span>
                </div>
                {!ready ? (
                  <PaperPreparation compact paper={paper} pipeline={pipelineStates[paper.id]}
                    configured={mineruConfigured} onStart={() => onStartMineru(paper.id)} />
                ) : null}
              </div>
              <button
                className={`icon-button favorite-button ${paper.favorite ? "is-favorite" : ""}`}
                aria-label={paper.favorite ? "取消收藏" : "收藏文献"}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFavorite(paper.id);
                }}
                title={paper.favorite ? "取消收藏" : "收藏文献"}
                type="button"
              >
                <Heart size={16} fill={paper.favorite ? "currentColor" : "none"} />
              </button>
            </article>
              );
          })
        )}
      </div>
    </section>
  );
}
