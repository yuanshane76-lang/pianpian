import { BookOpen, Clock3, Heart, LibraryBig, Settings2, Tags } from "lucide-react";

interface LibrarySidebarProps {
  activeFilter: string;
  tags: string[];
  onFilterChange: (filter: string) => void;
  onOpenSettings: () => void;
}

export function LibrarySidebar({ activeFilter, tags, onFilterChange, onOpenSettings }: LibrarySidebarProps) {
  const items = [
    { id: "all", label: "全部文献", icon: LibraryBig },
    { id: "favorite", label: "收藏", icon: Heart },
    { id: "recent", label: "最近阅读", icon: Clock3 },
  ];

  return (
    <aside className="library-sidebar">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <BookOpen size={18} strokeWidth={2.2} />
        </div>
        <div>
          <strong>纸研</strong>
          <span>研究工作台</span>
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

      <div className="sidebar-section-label">
        <Tags size={15} />
        <span>标签</span>
      </div>
      <div className="tag-list">
        {tags.length ? (
          tags.map((tag) => (
            <button
              className={`tag-link ${activeFilter === `tag:${tag}` ? "is-active" : ""}`}
              key={tag}
              onClick={() => onFilterChange(`tag:${tag}`)}
              type="button"
            >
              <span className="tag-dot" />
              {tag}
            </button>
          ))
        ) : (
          <span className="empty-tag-list">暂无标签</span>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="nav-item" type="button" onClick={onOpenSettings} title="模型与解析配置">
          <Settings2 size={17} />
          <span>服务配置</span>
        </button>
      </div>
    </aside>
  );
}
