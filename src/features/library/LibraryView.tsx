import { AlertTriangle, ArrowUpRight, BookMarked, FilePlus2, FolderOpen, Pencil, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import type { PaperMetadataPatch, PaperRecord } from "../../domain/library";
import { LibrarySidebar } from "./LibrarySidebar";
import { PaperEditDialog } from "./PaperEditDialog";
import { PaperList } from "./PaperList";

interface LibraryViewProps {
  onOpenWordbook?: () => void;
  wordbookCount?: number;
  papers: PaperRecord[];
  selectedPaper: PaperRecord | null;
  selectedId: string | null;
  query: string;
  filter: string;
  tags: string[];
  errorMessage: string | null;
  onFilterChange: (filter: string) => void;
  onQueryChange: (query: string) => void;
  onSelect: (paperId: string) => void;
  onImport: (file: File) => Promise<void>;
  onOpenReader: () => void;
  onToggleFavorite: (paperId: string) => void;
  onUpdateMetadata: (paperId: string, patch: PaperMetadataPatch) => void;
  onDelete: (paperId: string) => Promise<void>;
  onOpenSettings: () => void;
  importing: boolean;
}

export function LibraryView({
  papers,
  selectedPaper,
  selectedId,
  query,
  filter,
  tags,
  errorMessage,
  onFilterChange,
  onQueryChange,
  onSelect,
  onImport,
  onOpenReader,
  onToggleFavorite,
  onUpdateMetadata,
  onDelete,
  onOpenSettings,
  importing,
  onOpenWordbook, wordbookCount,
}: LibraryViewProps) {
  const [editing, setEditing] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!selectedPaper) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await onDelete(selectedPaper.id);
      setDeleteConfirmOpen(false);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除失败，请稍后重试。");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="workspace-shell">
        <button type="button" className="wordbook-button library-wordbook-button" aria-label="打开单词表" title="单词表" onClick={onOpenWordbook}><BookMarked size={17} /><span>单词表</span><small>{wordbookCount ?? 0}</small></button>
        <LibrarySidebar activeFilter={filter} tags={tags} onFilterChange={onFilterChange} onOpenSettings={onOpenSettings} />
        <PaperList
          papers={papers}
          selectedId={selectedId}
          query={query}
          errorMessage={errorMessage}
          onQueryChange={onQueryChange}
          onImport={onImport}
          onSelect={onSelect}
          onToggleFavorite={onToggleFavorite}
          importing={importing}
        />
        <section className="paper-detail-panel">
          {selectedPaper ? (
            <>
              <div className="detail-topbar">
                <span className="detail-path">文献库 / {selectedPaper.tags[0] ?? "待整理"}</span>
              </div>
              <div className="detail-content">
                <div className="paper-cover-mark" aria-hidden="true">
                  <FilePlus2 size={32} />
                </div>
                <span className="eyebrow">文献概览</span>
                <h2>{selectedPaper.title}</h2>
                <p className="detail-authors">
                  {selectedPaper.authors.length ? selectedPaper.authors.join(" · ") : "作者信息待补充"}
                </p>
                <div className="detail-stats">
                  <div>
                    <span>年份</span>
                    <strong>{selectedPaper.year ?? "—"}</strong>
                  </div>
                  <div>
                    <span>阅读块</span>
                    <strong>{selectedPaper.blocks}</strong>
                  </div>
                  <div>
                    <span>状态</span>
                    <strong>{selectedPaper.parseStatus === "fallback" ? "解析需重试" : "本地可读"}</strong>
                  </div>
                </div>
                <div className="tag-row">
                  {selectedPaper.tags.map((tag) => (
                    <span className="tag-chip" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="detail-actions">
                  <button className="primary-button" onClick={onOpenReader} type="button">
                    <ArrowUpRight size={17} />
                    打开阅读
                  </button>
                  <label className="secondary-button">
                    <FolderOpen size={17} />
                    导入 PDF
                    <input
                      accept="application/pdf,.pdf"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) onImport(file);
                        event.currentTarget.value = "";
                      }}
                      type="file"
                    />
                  </label>
                  <button className="secondary-button" aria-label="编辑文献" onClick={() => setEditing(true)} type="button">
                    <Pencil size={16} />
                    编辑信息
                  </button>
                  <button className="danger-button" aria-label="删除文献" onClick={() => { setDeleteError(""); setDeleteConfirmOpen(true); }} type="button">
                    <Trash2 size={16} />
                    删除文献
                  </button>
                </div>
                <div className="detail-note">
                  {selectedPaper.parseStatus === "fallback" ? (
                    <>
                      <AlertTriangle size={16} />
                      <span>PDF 文本解析失败，当前仅保留错误提示块：{selectedPaper.parseError}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      <span>AI 分析按需生成，结果会按内容签名缓存在本地。</span>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="detail-empty">
              <FilePlus2 size={32} />
              <h2>{papers.length ? "选择一篇文献开始" : "文献库还是空的"}</h2>
              <p>{papers.length ? "从左侧选择一篇文献查看详情。" : "导入 PDF 后，这里会成为你的研究入口。"}</p>
              {!papers.length ? (
                <label className="secondary-button">
                  <FolderOpen size={17} />
                  导入第一篇 PDF
                  <input
                    accept="application/pdf,.pdf"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) onImport(file);
                      event.currentTarget.value = "";
                    }}
                    type="file"
                  />
                </label>
              ) : null}
            </div>
          )}
        </section>
      </div>
      {editing && selectedPaper ? <PaperEditDialog
        paper={selectedPaper}
        onClose={() => setEditing(false)}
        onSave={(patch) => onUpdateMetadata(selectedPaper.id, patch)}
      /> : null}
      {deleteConfirmOpen && selectedPaper ? (
        <div className="settings-overlay">
          <section className="settings-dialog delete-dialog" role="dialog" aria-modal="true" aria-label="删除文献">
            <div className="delete-dialog-icon"><AlertTriangle size={22} /></div>
            <h2>删除这篇文献？</h2>
            <p>将从文献库移除《{selectedPaper.title}》，同时删除本机保存的原始 PDF、解析资产和这篇论文的 AI 缓存。此操作不可撤销。</p>
            {deleteError ? <p className="settings-error" role="alert">{deleteError}</p> : null}
            <div className="detail-actions">
              <button className="secondary-button" type="button" disabled={deleting} onClick={() => setDeleteConfirmOpen(false)}>取消</button>
              <button className="danger-button" aria-label="确认删除文献" type="button" disabled={deleting} onClick={() => void confirmDelete()}>
                <Trash2 size={15} />
                {deleting ? "正在删除…" : "确认删除"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
