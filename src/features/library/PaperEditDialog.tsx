import { Check, ChevronDown, FolderPlus, Pencil, Save, X } from "lucide-react";
import { useRef, useState } from "react";
import type { LibraryGroup, PaperMetadataPatch, PaperRecord } from "../../domain/library";

interface PaperEditDialogProps {
  paper: PaperRecord;
  groups: LibraryGroup[];
  onClose: () => void;
  onCreateGroup: (name: string) => LibraryGroup;
  onSave: (patch: PaperMetadataPatch) => void;
}

function splitValues(value: string): string[] {
  return [...new Set(value.split(/[,，;；\n]/).map((item) => item.trim()).filter(Boolean))];
}

export function PaperEditDialog({ paper, groups, onClose, onCreateGroup, onSave }: PaperEditDialogProps) {
  const [title, setTitle] = useState(paper.title);
  const [authors, setAuthors] = useState(paper.authors.join(", "));
  const [year, setYear] = useState(paper.year ? String(paper.year) : "");
  const [groupId, setGroupId] = useState(paper.groupId);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupError, setGroupError] = useState("");
  const createGroupButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");

  function save() {
    if (creatingGroup) return;
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError("标题不能为空。");
      return;
    }
    const normalizedYear = year.trim() ? Number(year.trim()) : null;
    if (normalizedYear !== null && (!Number.isInteger(normalizedYear) || normalizedYear < 0 || normalizedYear > 3000)) {
      setError("年份请填写 0 到 3000 之间的整数。");
      return;
    }
    onSave({
      title: normalizedTitle,
      authors: splitValues(authors),
      year: normalizedYear,
      groupId,
    });
    onClose();
  }

  function cancelGroup() {
    setCreatingGroup(false);
    setGroupError("");
    setNewGroupName("");
    createGroupButton.current?.focus();
  }

  function createGroup() {
    if (!newGroupName.trim()) { setGroupError("请填写分组名称。"); return; }
    try {
      const group = onCreateGroup(newGroupName.trim());
      setGroupId(group.id);
      cancelGroup();
    } catch (reason) {
      setGroupError(reason instanceof Error ? reason.message : "分组创建失败，请重试。");
    }
  }

  return (
    <div className="settings-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-dialog paper-edit-dialog" role="dialog" aria-modal="true" aria-label="编辑文献">
        <header className="settings-header">
          <div><Pencil size={18} /><h2>编辑文献</h2></div>
          <button className="icon-button" type="button" aria-label="关闭编辑文献" title="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="settings-body">
          <p className="settings-description">完善文献信息，方便查找与整理。</p>
          <label className="settings-field" htmlFor="paper-title">标题<input id="paper-title" value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} /></label>
          <label className="settings-field" htmlFor="paper-authors">作者 <span>用逗号或换行分隔</span><input id="paper-authors" value={authors} onChange={(event) => setAuthors(event.target.value)} /></label>
          <div className="paper-metadata-row">
            <label className="settings-field" htmlFor="paper-year">年份<input id="paper-year" inputMode="numeric" placeholder="例如 2024" value={year} onChange={(event) => setYear(event.target.value)} /></label>
            <div className="settings-field paper-group-field">
              <div className="paper-group-label"><label htmlFor={creatingGroup ? "paper-new-group" : "paper-group"}>所属分组</label>
                <button ref={createGroupButton} type="button" aria-label="在编辑文献中创建分组" aria-expanded={creatingGroup} onClick={() => { setCreatingGroup(true); setGroupError(""); }}>
                  <FolderPlus size={14} />新建分组
                </button>
              </div>
              {creatingGroup ? <div className="paper-group-create">
                <input autoFocus id="paper-new-group" aria-label="新分组名称" aria-invalid={Boolean(groupError)} aria-describedby={groupError ? "paper-group-error" : undefined} placeholder="输入分组名称" maxLength={40} value={newGroupName} onChange={(event) => { setNewGroupName(event.target.value); setGroupError(""); }} onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Enter") { event.preventDefault(); createGroup(); }
                  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelGroup(); }
                }} />
                <button type="button" className="paper-group-confirm" aria-label="确认创建分组" title="创建分组" onClick={createGroup}><Check size={16} /></button>
                <button type="button" aria-label="取消创建分组" title="取消" onClick={cancelGroup}><X size={16} /></button>
              </div> : <div className="paper-group-select">
                <select id="paper-group" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </div>}
              {groupError ? <p id="paper-group-error" className="settings-error" role="alert">{groupError}</p> : null}
            </div>
          </div>
          {error ? <p className="settings-error" role="alert">{error}</p> : null}
        </div>
        <footer className="settings-footer">
          <button className="secondary-button" type="button" onClick={onClose}>取消</button>
          <button className="primary-button" type="button" aria-label="保存文献" disabled={creatingGroup} onClick={save}><Save size={15} />保存修改</button>
        </footer>
      </section>
    </div>
  );
}
