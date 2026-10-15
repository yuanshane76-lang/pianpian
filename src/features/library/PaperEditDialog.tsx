import { Save, X } from "lucide-react";
import { useState } from "react";
import { isValidDoi, normalizeDoi, type PaperMetadataPatch, type PaperRecord } from "../../domain/library";

interface PaperEditDialogProps {
  paper: PaperRecord;
  onClose: () => void;
  onSave: (patch: PaperMetadataPatch) => void;
}

function splitValues(value: string): string[] {
  return [...new Set(value.split(/[,，;；\n]/).map((item) => item.trim()).filter(Boolean))];
}

export function PaperEditDialog({ paper, onClose, onSave }: PaperEditDialogProps) {
  const [title, setTitle] = useState(paper.title);
  const [authors, setAuthors] = useState(paper.authors.join(", "));
  const [year, setYear] = useState(paper.year ? String(paper.year) : "");
  const [tags, setTags] = useState(paper.tags.join(", "));
  const [doi, setDoi] = useState(paper.doi ?? "");
  const [error, setError] = useState("");

  function save() {
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
    const trimmedDoi = doi.trim();
    if (trimmedDoi && !isValidDoi(trimmedDoi)) {
      setError("DOI 格式不正确，应形如 10.1145/3592433。");
      return;
    }
    onSave({
      title: normalizedTitle,
      authors: splitValues(authors),
      year: normalizedYear,
      tags: splitValues(tags),
      doi: normalizeDoi(trimmedDoi),
    });
    onClose();
  }

  return (
    <div className="settings-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-dialog paper-edit-dialog" role="dialog" aria-modal="true" aria-label="编辑文献">
        <header className="settings-header">
          <div><Save size={18} /><h2>编辑文献</h2></div>
          <button className="icon-button" type="button" aria-label="关闭编辑文献" title="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="settings-body">
          <p className="settings-description">只修改文献库信息，不会改变原始 PDF、解析结果或阅读进度。</p>
          <label className="settings-field" htmlFor="paper-title">标题<input id="paper-title" value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} /></label>
          <label className="settings-field" htmlFor="paper-authors">作者 <span>用逗号或换行分隔</span><input id="paper-authors" value={authors} onChange={(event) => setAuthors(event.target.value)} /></label>
          <label className="settings-field" htmlFor="paper-year">年份<input id="paper-year" inputMode="numeric" placeholder="例如 2024" value={year} onChange={(event) => setYear(event.target.value)} /></label>
          <label className="settings-field" htmlFor="paper-tags">标签 <span>用逗号或换行分隔</span><input id="paper-tags" placeholder="例如 Transformer, NLP" value={tags} onChange={(event) => setTags(event.target.value)} /></label>
          <label className="settings-field" htmlFor="paper-doi">DOI <span>选填，用于查找相似论文</span><input id="paper-doi" placeholder="例如 10.1145/3592433" value={doi} onChange={(event) => { setDoi(event.target.value); setError(""); }} /></label>
          {error ? <p className="settings-error" role="alert">{error}</p> : null}
        </div>
        <footer className="settings-footer">
          <button className="secondary-button" type="button" onClick={onClose}>取消</button>
          <button className="primary-button" type="button" aria-label="保存文献" onClick={save}><Save size={15} />保存修改</button>
        </footer>
      </section>
    </div>
  );
}
