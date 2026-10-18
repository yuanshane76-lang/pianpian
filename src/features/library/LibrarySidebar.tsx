import { useEffect, useState } from "react";
import { Clock3, FolderKanban, Heart, LibraryBig, Plus, RefreshCw, Settings2 } from "lucide-react";
import { brand, Pianpian } from "../../brand/Pianpian";
import { ThemeToggle } from "../settings/ThemeToggle";
import type { LibraryGroup } from "../../domain/library";
import { getDesktopBridge } from "../../platform/electron";

interface LibrarySidebarProps {
  activeFilter: string;
  groups: LibraryGroup[];
  onFilterChange: (filter: string) => void;
  onCreateGroup: () => void;
  onOpenSettings: () => void;
}

export function LibrarySidebar({ activeFilter, groups, onFilterChange, onCreateGroup, onOpenSettings }: LibrarySidebarProps) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge?.isDesktop) return;
    let active = true;
    const reflect = (state: { phase?: string }) => {
      if (active) setUpdateAvailable(state.phase === "available" || state.phase === "downloaded");
    };
    void bridge.invoke<{ phase?: string }>("zhiyan:update:state").then(reflect).catch(() => {});
    const unsubscribe = bridge.on?.<{ phase?: string }>("zhiyan:update:event", reflect);
    return () => { active = false; unsubscribe?.(); };
  }, []);
  const items = [
    { id: "all", label: "全部文献", icon: LibraryBig },
    { id: "favorite", label: "收藏", icon: Heart },
    { id: "recent", label: "最近阅读", icon: Clock3 },
  ];

  return (
    <aside className="library-sidebar">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <Pianpian />
        </div>
        <div>
          <strong>{brand.name}</strong>
          <span>论文阅读伙伴</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="文献导航">
        {items.map(({ id, label, icon: Icon }) => (
          <button
            className={`nav-item ${activeFilter === id ? "is-active" : ""}`}
            key={id}
            onClick={() => onFilterChange(id)}
            type="button"
          >
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-groups">
        <div className="sidebar-section-label">
          <FolderKanban size={15} />
          <span>分组</span>
          <button className="icon-button sidebar-add-button" type="button" aria-label="创建分组" title="创建分组" onClick={onCreateGroup}>
            <Plus size={15} />
          </button>
        </div>
        <div className="group-list">
          {groups.length ? (
            groups.map((group) => (
              <button
                className={`group-link ${activeFilter === `group:${group.id}` ? "is-active" : ""}`}
                key={group.id}
                aria-label={`分组：${group.name}`}
                onClick={() => onFilterChange(`group:${group.id}`)}
                type="button"
              >
                <span className="group-dot" />
                <span>{group.name}</span>
              </button>
            ))
          ) : (
            <span className="empty-group-list">暂无分组</span>
          )}
        </div>
      </div>

      <div className="sidebar-footer">
        {getDesktopBridge()?.isDesktop ? <button className="nav-item" type="button" aria-label={updateAvailable ? "检查更新，有新版本" : "检查更新"} onClick={() => window.dispatchEvent(new Event("pianpian:updates:open"))}><span className="update-trigger-icon"><RefreshCw size={17} />{updateAvailable ? <span className="update-available-dot" aria-hidden="true" /> : null}</span><span>检查更新</span></button> : null}
        <button className="nav-item" type="button" aria-label="服务配置" onClick={onOpenSettings} title="模型与解析配置">
          <Settings2 size={17} />
          <span>服务配置</span>
        </button>
        <ThemeToggle />
      </div>
    </aside>
  );
}
