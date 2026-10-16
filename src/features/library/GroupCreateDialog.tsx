import { FolderPlus, Save, X } from "lucide-react";
import { useState } from "react";

interface GroupCreateDialogProps {
  onClose: () => void;
  onSave: (name: string) => void;
}

export function GroupCreateDialog({ onClose, onSave }: GroupCreateDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  function save() {
    if (!name.trim()) {
      setError("分组名称不能为空。");
      return;
    }
    try {
      onSave(name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "分组保存失败，请稍后重试。");
    }
  }

  return (
    <div className="settings-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-dialog group-create-dialog" role="dialog" aria-modal="true" aria-label="创建分组">
        <header className="settings-header">
          <div><FolderPlus size={18} /><h2>创建分组</h2></div>
          <button className="icon-button" type="button" aria-label="关闭创建分组" title="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="settings-body">
          <p className="settings-description">创建后可以把论文归入这个分组。一篇论文只能归属一个分组。</p>
          <label className="settings-field" htmlFor="group-name">分组名称
            <input id="group-name" autoFocus value={name} onChange={(event) => { setName(event.target.value); setError(""); }} placeholder="例如 深度学习" />
          </label>
          {error ? <p className="settings-error" role="alert">{error}</p> : null}
        </div>
        <footer className="settings-footer">
          <button className="secondary-button" type="button" onClick={onClose}>取消</button>
          <button className="primary-button" type="button" aria-label="保存分组" onClick={save}><Save size={15} />保存分组</button>
        </footer>
      </section>
    </div>
  );
}
