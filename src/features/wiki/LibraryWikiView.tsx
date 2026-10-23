import { BookOpenText, ChevronLeft, Search, Share2, Waypoints } from "lucide-react";
import { useMemo, useState } from "react";
import {
  buildLibraryWikiIndex,
  type LibraryWikiPage,
} from "../../domain/libraryWiki";
import { LibraryWikiGraph } from "./LibraryWikiGraph";

const KIND_LABEL: Record<string, string> = { concept: "概念", method: "方法" };

interface Props {
  pages: LibraryWikiPage[];
  /** 判断某篇论文当前能否打开阅读（用于原文跳转可用性）。 */
  canJump: (paperId: string) => boolean;
  onJump: (paperId: string, blockId: string) => void;
  onBack: () => void;
}

export function LibraryWikiView({ pages, canJump, onJump, onBack }: Props) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(pages[0]?.id ?? null);
  const [showGraph, setShowGraph] = useState(false);
  const index = useMemo(() => buildLibraryWikiIndex(pages), [pages]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const list = normalizedQuery
    ? index.pages.filter((page) =>
      `${page.title}${page.aliases.join("")}`.toLocaleLowerCase().includes(normalizedQuery))
    : index.pages;
  const selected = index.pages.find((page) => page.id === selectedId) ?? list[0] ?? null;
  const selectedBacklinks = selected ? index.backlinks[selected.id] ?? [] : [];
  const selectedLinks = selected ? index.links[selected.id] ?? [] : [];
  const byId = useMemo(() => new Map(index.pages.map((page) => [page.id, page])), [index]);

  return <main className="library-wiki">
    <header className="library-wiki-header">
      <button type="button" className="back-button" onClick={onBack}><ChevronLeft size={17} />返回文献库</button>
      <div className="library-wiki-title"><BookOpenText size={17} /><strong>论文知识库</strong></div>
      <div className="library-wiki-header-meta">
        <span>{index.pages.length} 个页面</span>
        <span>{index.totalCitations} 条原文锚点</span>
      </div>
      <button type="button" className={`text-button ${showGraph ? "is-active" : ""}`} aria-pressed={showGraph}
        onClick={() => setShowGraph((current) => !current)}>
        <Waypoints size={14} />{showGraph ? "返回页面" : "图谱视图"}
      </button>
    </header>
    {showGraph ? <div className="library-wiki-graph-wrap">
      <LibraryWikiGraph index={index} selectedId={selected?.id ?? null} onSelect={(page) => setSelectedId(page.id)} />
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
        }) : <p className="library-wiki-empty">{pages.length ? "没有匹配的知识页面。" : "还没有知识页面。生成论文的文章架构后，其中的概念与方法会自动汇聚到这里。"}</p>}
      </aside>
      {selected ? <section className="library-wiki-detail" aria-label={selected.title}>
        <div className="library-wiki-detail-head">
          <span className={`library-wiki-kind ${selected.kind}`}>{KIND_LABEL[selected.kind] ?? selected.kind}</span>
          <h2>{selected.title}</h2>
        </div>
        {selected.aliases.length ? <p className="library-wiki-aliases">别名：{selected.aliases.join("、")}</p> : null}
        {selected.summary ? <p className="library-wiki-summary">{selected.summary}</p> : null}
        <h3 className="library-wiki-section-title">出现于 {Object.keys(selected.occurrences).length} 篇论文</h3>
        <div className="library-wiki-occurrences">
          {Object.values(selected.occurrences).map((occurrence) => {
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
        {selectedLinks.length ? <div className="library-wiki-linkbox">
          <h3><Share2 size={13} /> 链接（{selectedLinks.length}）</h3>
          <div className="library-wiki-linkchips">
            {selectedLinks.map((id) => byId.get(id)).filter(Boolean).map((page) => page!)
              .map((page) => <button key={page.id} type="button" onClick={() => setSelectedId(page.id)}>{page.title}</button>)}
          </div>
        </div> : null}
        {selectedBacklinks.length ? <div className="library-wiki-linkbox">
          <h3><Share2 size={13} /> 反向链接（{selectedBacklinks.length}）</h3>
          <div className="library-wiki-linkchips">
            {selectedBacklinks.map((id) => byId.get(id)).filter(Boolean).map((page) => page!)
              .map((page) => <button key={page.id} type="button" onClick={() => setSelectedId(page.id)}>{page.title}</button>)}
          </div>
        </div> : null}
      </section> : <section className="library-wiki-detail library-wiki-detail-empty">
        <p>选择左侧页面查看跨论文的知识汇聚。</p>
      </section>}
    </div>}
  </main>;
}
