import { BookOpenText, ChevronLeft, List, LoaderCircle, RefreshCw, Search, Share2, Waypoints, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  buildLibraryWikiIndex,
  type LibraryWikiPage,
} from "../../domain/libraryWiki";
import { LibraryWikiGraph } from "./LibraryWikiGraph";

const KIND_LABEL: Record<string, string> = { concept: "概念", method: "方法" };

interface Props {
  pages: LibraryWikiPage[];
  /** 逐篇知识提取进度；null 表示不在提取中。 */
  progress: { done: number; total: number } | null;
  /** 提取失败的论文（论文 id → 错误信息）。 */
  failures: Record<string, string> | null;
  onRetryFailed: () => void;
  /** 判断某篇论文当前能否打开阅读（用于原文跳转可用性）。 */
  canJump: (paperId: string) => boolean;
  onJump: (paperId: string, blockId: string) => void;
  onBack: () => void;
}

/** 页面详情：星图模式的浮动卡片与列表模式的右栏共用。 */
function WikiPageDetail({ page, index, canJump, onJump, onNavigate, onClose }: {
  page: LibraryWikiPage;
  index: ReturnType<typeof buildLibraryWikiIndex>;
  canJump: (paperId: string) => boolean;
  onJump: (paperId: string, blockId: string) => void;
  onNavigate?: (page: LibraryWikiPage) => void;
  onClose?: () => void;
}): ReactNode {
  const byId = useMemo(() => new Map(index.pages.map((item) => [item.id, item])), [index]);
  const links = index.links[page.id] ?? [];
  const backlinks = index.backlinks[page.id] ?? [];
  return <section className="library-wiki-detail" aria-label={page.title}>
    <div className="library-wiki-detail-head">
      <span className={`library-wiki-kind ${page.kind}`}>{KIND_LABEL[page.kind] ?? page.kind}</span>
      <h2>{page.title}</h2>
      {onClose ? <button className="icon-button" type="button" aria-label="关闭详情" onClick={onClose}><X size={15} /></button> : null}
    </div>
    {page.aliases.length ? <p className="library-wiki-aliases">别名：{page.aliases.join("、")}</p> : null}
    {page.summary ? <p className="library-wiki-summary">{page.summary}</p> : null}
    <h3 className="library-wiki-section-title">出现于 {Object.keys(page.occurrences).length} 篇论文</h3>
    <div className="library-wiki-occurrences">
      {Object.values(page.occurrences).map((occurrence) => {
        const jumpable = canJump(occurrence.paperId);
        return <article key={occurrence.paperId} className={`library-wiki-occurrence ${jumpable ? "" : "is-unavailable"}`}>
          <strong title={occurrence.paperTitle}>{occurrence.paperTitle}</strong>
          {occurrence.statements.map((statement, position) => <p key={position}>{statement}</p>)}
          <div className="library-wiki-citations">
            {occurrence.citations.map((citation) => jumpable
              ? <button key={citation.blockId} type="button" className="library-wiki-citation"
                  title={citation.quote}
                  onClick={() => onJump(citation.paperId, citation.blockId)}>
                  第 {citation.pageNumber} 页 ↗
                </button>
              : <span key={citation.blockId} className="library-wiki-citation is-disabled" title="该论文已不在文献库或未完成解析">第 {citation.pageNumber} 页</span>)}
          </div>
        </article>;
      })}
    </div>
    {links.length ? <div className="library-wiki-linkbox">
      <h3><Share2 size={13} /> 链接（{links.length}）</h3>
      <div className="library-wiki-linkchips">
        {links.map((id) => byId.get(id)).filter(Boolean).map((item) => item!)
          .map((item) => <button key={item.id} type="button" onClick={() => onNavigate?.(item)}>{item.title}</button>)}
      </div>
    </div> : null}
    {backlinks.length ? <div className="library-wiki-linkbox">
      <h3><Share2 size={13} /> 反向链接（{backlinks.length}）</h3>
      <div className="library-wiki-linkchips">
        {backlinks.map((id) => byId.get(id)).filter(Boolean).map((item) => item!)
          .map((item) => <button key={item.id} type="button" onClick={() => onNavigate?.(item)}>{item.title}</button>)}
      </div>
    </div> : null}
  </section>;
}

export function LibraryWikiView({ pages, progress, failures, onRetryFailed, canJump, onJump, onBack }: Props) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"star" | "list">("star");
  // undefined = 初始（回退到第一个页面）；null = 用户显式关闭了详情。
  const [selectedId, setSelectedId] = useState<string | null | undefined>(pages[0]?.id);
  const index = useMemo(() => buildLibraryWikiIndex(pages), [pages]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const list = normalizedQuery
    ? index.pages.filter((page) =>
      `${page.title}${page.aliases.join("")}`.toLocaleLowerCase().includes(normalizedQuery))
    : index.pages;
  const selected = selectedId === null ? null
    : index.pages.find((page) => page.id === selectedId)
      ?? (selectedId === undefined ? list[0] ?? null : null);
  const generating = progress !== null;

  return <main className="library-wiki">
    <header className="library-wiki-header">
      <button type="button" className="back-button" onClick={onBack}><ChevronLeft size={17} />返回文献库</button>
      <div className="library-wiki-title"><BookOpenText size={17} /><strong>论文知识库</strong></div>
      <div className="library-wiki-header-meta">
        <span>{index.pages.length} 个页面</span>
        <span>{index.totalCitations} 条原文锚点</span>
        {progress ? <span className="library-wiki-progress">
          <LoaderCircle className="spin" size={11} /> 正在提取 {progress.done}/{progress.total}
        </span> : null}
        {failures && !progress ? <button className="text-button" type="button" onClick={onRetryFailed}>
          <RefreshCw size={12} />{Object.keys(failures).length} 篇提取失败 · 重试
        </button> : null}
      </div>
      <button type="button" className={`text-button ${mode === "list" ? "is-active" : ""}`} aria-pressed={mode === "list"}
        onClick={() => setMode((current) => (current === "star" ? "list" : "star"))}>
        {mode === "star" ? <><List size={14} />列表视图</> : <><Waypoints size={14} />星图视图</>}
      </button>
    </header>
    {mode === "star" ? <div className="wiki-starmap-wrap">
      <LibraryWikiGraph index={index} selectedId={selected?.id ?? null} onSelect={(page) => setSelectedId(page.id)} />
      <div className="wiki-starmap-search">
        <Search size={14} />
        <input aria-label="搜索知识页面" placeholder="搜索概念或方法" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        {normalizedQuery ? <div className="wiki-starmap-hits">
          {list.length ? list.slice(0, 8).map((page) => <button key={page.id} type="button" onClick={() => setSelectedId(page.id)}>
            <span className={`library-wiki-kind ${page.kind}`}>{KIND_LABEL[page.kind] ?? page.kind}</span>
            {page.title}
            <small>{Object.keys(page.occurrences).length} 篇</small>
          </button>) : <span className="wiki-starmap-hits-empty">没有匹配的知识页面。</span>}
        </div> : null}
      </div>
      {selected ? <div className="wiki-starmap-detail">
        <WikiPageDetail page={selected} index={index} canJump={canJump} onJump={onJump}
          onNavigate={(page) => setSelectedId(page.id)} onClose={() => setSelectedId(null)} />
      </div> : <div className="wiki-starmap-hint">点击星星查看知识页面；滚轮缩放，拖拽平移。</div>}
    </div> : <div className="library-wiki-body">
      <aside className="library-wiki-list" aria-label="知识页面列表">
        <div className="library-wiki-search">
          <Search size={14} />
          <input aria-label="搜索知识页面" placeholder="搜索概念或方法" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        {list.length ? list.map((page) => {
          const count = Object.keys(page.occurrences).length;
          return <button
            key={page.id}
            type="button"
            className={`library-wiki-item ${page.id === selected?.id ? "is-selected" : ""}`}
            onClick={() => setSelectedId(page.id)}
          >
            <span className={`library-wiki-kind ${page.kind}`}>{KIND_LABEL[page.kind] ?? page.kind}</span>
            <span className="library-wiki-item-title">{page.title}</span>
            <span className="library-wiki-item-count">{count} 篇</span>
          </button>;
        }) : <p className="library-wiki-empty">{pages.length ? "没有匹配的知识页面。" : "还没有知识页面。已提取过知识的论文会自动汇聚到这里；打开知识库会按论文列表逐篇提取。"}</p>}
      </aside>
      {selected ? <WikiPageDetail page={selected} index={index} canJump={canJump} onJump={onJump}
        onNavigate={(page) => setSelectedId(page.id)} /> : <section className="library-wiki-detail library-wiki-detail-empty">
        <p>选择左侧页面查看跨论文的知识汇聚。</p>
      </section>}
    </div>}
  </main>;
}
