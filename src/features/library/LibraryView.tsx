import { AlertTriangle, ArrowUpRight, BookMarked, FilePlus2, FolderOpen, Pencil, Sparkles, Trash2, Waypoints } from "lucide-react";
import { Pianpian } from "../../brand/Pianpian";
import { useState } from "react";
import { DEFAULT_GROUP_NAME, type LibraryGroup, type PaperMetadataPatch, type PaperRecord } from "../../domain/library";
import { canOpenPaper, getLibraryPreparation, getPaperPipelineState, type PaperPipelineState } from "../../domain/pipeline";
import { PaperPreparation } from "./PaperPreparation";
import { LibrarySidebar } from "./LibrarySidebar";
import { PaperEditDialog } from "./PaperEditDialog";
import { PaperList } from "./PaperList";
import { GroupCreateDialog } from "./GroupCreateDialog";

interface LibraryViewProps {
  onOpenResearch?: () => void;
  onOpenWiki?: () => void;
  wikiPageCount?: number;
  onOpenWordbook?: () => void;
  wordbookCount?: number;
  papers: PaperRecord[];
  selectedPaper: PaperRecord | null;
  selectedId: string | null;
  query: string;
  filter: string;
  groups: LibraryGroup[];
  errorMessage: string | null;
  onFilterChange: (filter: string) => void;
  onQueryChange: (query: string) => void;
  onSelect: (paperId: string) => void;
  onImport: (file: File) => Promise<void>;
  onOpenReader: () => void;
  onStartMineru: (paperId: string) => void;
  onToggleFavorite: (paperId: string) => void;
  onUpdateMetadata: (paperId: string, patch: PaperMetadataPatch) => void;
  onCreateGroup: (name: string) => LibraryGroup;
  onDeleteGroup: (groupId: string) => Promise<void>;
  onDelete: (paperId: string) => Promise<void>;
  onOpenSettings: () => void;
  pipelineStates: Record<string, PaperPipelineState>;
  mineruConfigured: boolean;
  importing: boolean;
}

export function LibraryView({
  papers,
  selectedPaper,
  selectedId,
  query,
  filter,
  groups,
  errorMessage,
  onFilterChange,
  onQueryChange,
  onSelect,
  onImport,
  onOpenReader,
  onStartMineru,
  onToggleFavorite,
  onUpdateMetadata,
  onCreateGroup,
  onDeleteGroup,
  onDelete,
  onOpenSettings,
  pipelineStates,
  mineruConfigured,
  importing,
  onOpenWordbook, wordbookCount,
  onOpenResearch,
  onOpenWiki, wikiPageCount,
}: LibraryViewProps) {
  const [editing, setEditing] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<LibraryGroup | null>(null);
  const [groupDeleteError, setGroupDeleteError] = useState("");
  const [deletingGroup, setDeletingGroup] = useState(false);
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

  async function confirmDeleteGroup() {
    if (!groupToDelete) return;
    setDeletingGroup(true);
    setGroupDeleteError("");
    try {
      await onDeleteGroup(groupToDelete.id);
      setGroupToDelete(null);
    } catch (error) {
      setGroupDeleteError(error instanceof Error ? error.message : "删除分组失败，请稍后重试。");
    } finally {
      setDeletingGroup(false);
    }
  }

  const selectedPipeline = selectedPaper
    ? getPaperPipelineState(selectedPaper, pipelineStates[selectedPaper.id])
    : null;
  const selectedReady = selectedPaper
    ? canOpenPaper(selectedPaper, pipelineStates[selectedPaper.id])
    : false;
  const selectedActive = selectedPaper
    ? getLibraryPreparation(selectedPaper, pipelineStates[selectedPaper.id], mineruConfigured).active
    : false;

  return (
    <>
      <div className="workspace-shell">
        <div className="library-global-tools">{onOpenResearch ? <button type="button" className="wordbook-button" aria-label="问问篇篇" onClick={onOpenResearch}><Pianpian /><span>问问篇篇</span></button> : null}{onOpenWiki ? <button type="button" className="wordbook-button" aria-label="打开论文知识库" title="跨论文的概念与方法汇聚" onClick={onOpenWiki}><Waypoints size={17} /><span>知识库</span><small>{wikiPageCount ?? 0}</small></button> : null}<button type="button" className="wordbook-button" aria-label="打开单词表" title="单词表" onClick={onOpenWordbook}><BookMarked size={17} /><span>单词表</span><small>{wordbookCount ?? 0}</small></button></div>
        <LibrarySidebar activeFilter={filter} groups={groups} onFilterChange={onFilterChange} onCreateGroup={() => setCreatingGroup(true)} onDeleteGroup={(group) => { setGroupDeleteError(""); setGroupToDelete(group); }} onOpenSettings={onOpenSettings} />
        <PaperList
          papers={papers}
          selectedId={selectedId}
          query={query}
          errorMessage={errorMessage}
          onQueryChange={onQueryChange}
          onImport={onImport}
          onSelect={onSelect}
          onToggleFavorite={onToggleFavorite}
          onStartMineru={onStartMineru}
          pipelineStates={pipelineStates}
          mineruConfigured={mineruConfigured}
          importing={importing}
        />
        <section className="paper-detail-panel">
          {selectedPaper ? (
            <>
              <div className="detail-topbar">
                <span className="detail-path">文献库 / {groups.find((group) => group.id === selectedPaper.groupId)?.name ?? DEFAULT_GROUP_NAME}</span>
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
                    <strong>{selectedPaper.recordType === "reference" ? "文献条目" : selectedReady ? "可阅读" : selectedPipeline?.stage === "failed" ? "解析失败" : selectedActive ? "处理中" : "等待 MinerU"}</strong>
                  </div>
                </div>
                <div className="group-row">
                  <span className="group-chip">{groups.find((group) => group.id === selectedPaper.groupId)?.name ?? DEFAULT_GROUP_NAME}</span>
                </div>
                {selectedPaper.recordType === "reference" ? <div className="reference-detail-note"><strong>已收藏文献信息，全文待导入</strong><p>{selectedPaper.abstract || "这条记录来自公开学术检索。导入原始 PDF 并完成解析后即可阅读。"}</p>{selectedPaper.doi ? <span>DOI：{selectedPaper.doi}</span> : null}</div> : !selectedReady && <PaperPreparation paper={selectedPaper} pipeline={selectedPipeline!}
                  configured={mineruConfigured} onStart={() => onStartMineru(selectedPaper.id)} />}
                <div className="detail-actions">
                  <button className="primary-button" aria-label="打开阅读" disabled={!selectedReady} onClick={onOpenReader} type="button" title={selectedReady ? "打开阅读" : "MinerU 解析与坐标定位完成后才能阅读"}>
                    <ArrowUpRight size={17} />
                    {selectedPaper.recordType === "reference" ? "全文待导入" : selectedReady ? "打开阅读" : "等待解析完成"}
                  </button>
                  <label className="secondary-button">
                    <FolderOpen size={17} />
                    导入 PDF
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
                  <Sparkles size={16} />
                  <span>{selectedPaper.recordType === "reference" ? "文献条目保存在本机，当前未下载或上传全文。" : selectedReady ? "AI 分析按需生成，结果会按内容签名缓存在本地。" : "导入后自动上传到 MinerU 解析，会使用你的账号额度；原始 PDF 保存在本机。"}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="detail-empty">
              <Pianpian variant="reading" />
              <h2>{papers.length ? "今天，我们一起读哪篇？" : "每篇论文，都有个伴。"}</h2>
              <p>{papers.length ? "从左侧选择一篇文献，篇篇陪你读。" : "导入第一篇 PDF，让篇篇陪你读明白。"}</p>
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
        groups={groups}
        onClose={() => setEditing(false)}
        onCreateGroup={onCreateGroup}
        onSave={(patch) => onUpdateMetadata(selectedPaper.id, patch)}
      /> : null}
      {creatingGroup ? <GroupCreateDialog
        onClose={() => setCreatingGroup(false)}
        onSave={(name) => {
          onCreateGroup(name);
          setCreatingGroup(false);
        }}
      /> : null}
      {groupToDelete ? (
        <div className="settings-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !deletingGroup) setGroupToDelete(null); }}>
          <section className="settings-dialog delete-dialog" role="dialog" aria-modal="true" aria-label="删除分组">
            <div className="delete-dialog-icon"><AlertTriangle size={22} /></div>
            <h2>删除分组“{groupToDelete.name}”？</h2>
            <p>组内论文会移到“{DEFAULT_GROUP_NAME}”。不会删除论文、原始 PDF 或解析资料。</p>
            {groupDeleteError ? <p className="settings-error" role="alert">{groupDeleteError}</p> : null}
            <div className="detail-actions">
              <button className="secondary-button" type="button" disabled={deletingGroup} aria-label="取消删除分组" onClick={() => setGroupToDelete(null)}>取消</button>
              <button className="danger-button" type="button" disabled={deletingGroup} aria-label="确认删除分组" onClick={() => void confirmDeleteGroup()}>
                <Trash2 size={15} />
                {deletingGroup ? "正在删除…" : "确认删除"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
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
