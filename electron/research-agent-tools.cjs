const { randomUUID } = require("node:crypto");
const { searchLiterature } = require("./literature-search.cjs");
const { readBundledResearchSkill } = require("./research-skills.cjs");

const LIMITS = { blocks: 800, blockText: 6000, library: 5000, query: 300 };

function text(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function normalizeLandingUrl(value) {
  let url = text(value, 2000);
  if (!url) return undefined;
  if (/^(?:dx\.)?doi\.org\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error();
    return parsed.href;
  } catch { throw new Error("论文链接无效，请使用 HTTP 或 HTTPS 链接"); }
}

function normalizeContext(value) {
  if (JSON.stringify(value ?? {}).length > 8_000_000) throw new Error("论文上下文过大");
  const source = value && typeof value === "object" ? value : {};
  if (Array.isArray(source.library) && source.library.length > LIMITS.library) throw new Error("文献库超过当前 5000 篇检索上限，请缩小范围");
  const scope = source.scope === "library" ? "library" : "paper";
  const paper = scope === "paper" && source.paper && typeof source.paper === "object" ? source.paper : null;
  if (scope === "paper" && (!paper || !text(paper.id, 200) || !text(paper.title, 500))) throw new Error("当前论文上下文无效");
  const blocks = Array.isArray(paper?.blocks) ? paper.blocks : [];
  if (blocks.length > LIMITS.blocks) throw new Error("阅读块数量超过限制");
  const normalizedBlocks = blocks.map((block, index) => ({
    id: text(block?.id, 200) || `block-${index + 1}`,
    pageNumber: Number.isInteger(block?.pageNumber) ? block.pageNumber : 1,
    text: text(block?.text, LIMITS.blockText),
  })).filter((block) => block.text);
  const library = Array.isArray(source.library) ? source.library.slice(0, LIMITS.library).map((item) => ({
    id: text(item?.id, 200),
    originalId: text(item?.originalId, 200) || undefined,
    title: text(item?.title, 500),
    authors: Array.isArray(item?.authors) ? item.authors.slice(0, 20).map((author) => text(author, 120)).filter(Boolean) : [],
    year: Number.isInteger(item?.year) ? item.year : null,
    doi: text(item?.doi, 500) || undefined,
  })).filter((item) => item.id && item.title) : [];
  return {
    scope,
    paper: paper ? {
      id: text(paper.id, 200),
      title: text(paper.title, 500),
      authors: Array.isArray(paper.authors) ? paper.authors.slice(0, 20).map((author) => text(author, 120)).filter(Boolean) : [],
      year: Number.isInteger(paper.year) ? paper.year : null,
      blocks: normalizedBlocks,
    } : null,
    library,
  };
}

function matchesQuery(item, query) {
  const haystack = [item.title, ...(item.authors ?? []), item.year, item.doi].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase();
  const normalized = query.normalize("NFKC").toLocaleLowerCase();
  if (haystack.includes(normalized)) return true;
  const terms = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  return terms.length > 0 && terms.every((term) => haystack.includes(term));
}

function toolResult(textContent, structuredContent) {
  return { content: [{ type: "text", text: structuredContent === undefined ? textContent : `${textContent}\n${JSON.stringify(structuredContent)}` }],
    details: structuredContent, ...(structuredContent === undefined ? {} : { structuredContent }) };
}

function createToolDefinitions({ getContext, emitApproval, fetchImpl, readLibraryPaper }) {
  const tool = (name, label, description, execute) => ({ name, label, description, parameters: { type: "object", properties: {}, additionalProperties: false }, execute });
  return [
    tool("read_research_skill", "读取预置研究技能", "按名称读取随篇篇安装的阅读流程说明；不接受文件路径。", async (_id, params) => {
      const skill = readBundledResearchSkill(params?.name);
      return toolResult(`已读取预置研究技能「${skill.title}」。`, skill);
    }),
    tool("read_current_paper", "读取论文正文", "单篇会话读取当前论文；全库会话必须传入检索结果中的 paperId。支持关键词和页码，最多返回 60 个块。", async (_id, params) => {
      const context = getContext();
      let paper = context.paper;
      if (context.scope === "library") {
        const item = context.library.find((x) => x.id === params?.paperId);
        if (!params?.paperId) throw new Error("请先检索并指定要读取的论文 paperId");
        if (!item) throw new Error("指定论文不在当前文献库中");
        paper = await readLibraryPaper?.(item);
        if (!paper?.blocks?.length) throw new Error("该论文尚无可用的解析正文，请先完成 PDF 导入与解析");
      } else if (params?.paperId && params.paperId !== paper.id) throw new Error("单篇会话只能读取当前论文");
      let remaining = 24000;
      const selected = paper.blocks.filter((block) => (!params?.page || block.pageNumber === params.page) &&
        (!params?.query || block.text.toLocaleLowerCase().includes(params.query.toLocaleLowerCase())))
        .slice(0, 60).map((block) => {
          const text = block.text.slice(0, Math.max(0, remaining));
          remaining -= text.length;
          return { ...block, text };
        }).filter((block) => block.text);
      return toolResult(`读取《${paper.title}》：返回 ${selected.length} / ${paper.blocks.length} 个阅读块。`, {
        paper: { ...paper, blocks: selected }, totalBlocks: paper.blocks.length, truncated: remaining <= 0,
        citations: selected.slice(0, 8).map((block) => ({ paperId: paper.id, blockId: block.id, pageNumber: block.pageNumber, label: `第 ${block.pageNumber} 页` })),
      });
    }),
    tool("search_library", "搜索本地文献库", "全库会话检索本地论文标题、作者及已解析正文，返回相关段落摘要；单篇会话只搜索文献元数据。", async (_id, params, signal) => {
      const query = text(params?.query, LIMITS.query);
      if (!query) throw new Error("本地文献检索关键词无效");
      const context = getContext();
      const matches = [];
      for (const item of context.library) {
        if (signal?.aborted) throw new Error("本地检索已取消");
        const parsed = context.scope === "library" ? await readLibraryPaper?.(item) : null;
        const snippets = (parsed?.blocks || []).filter((block) => matchesQuery({ title: block.text }, query)).slice(0, 3).map((block) => {
          const index = block.text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
          const start = Math.max(0, index - 100);
          return { blockId: block.id, pageNumber: block.pageNumber, text: block.text.slice(start, start + 600) };
        });
        if (matchesQuery(item, query) || snippets.length) matches.push({ ...item, parsed: Boolean(parsed?.blocks?.length), snippets });
      }
      const papers = [];
      let remaining = 40000;
      for (const paper of matches) {
        const size = JSON.stringify(paper).length + 1;
        if (size > remaining) break;
        papers.push(paper);
        remaining -= size;
      }
      return toolResult(`本地文献库找到 ${matches.length} 篇论文，本次返回 ${papers.length} 篇；可缩小关键词继续检索。`, {
        papers, totalMatches: matches.length, truncated: papers.length < matches.length,
      });
    }),
    tool("search_literature", "检索公开文献", "检索公开学术元数据，只返回论文候选，不下载全文。", async (_id, params, signal) => {
      const result = await searchLiterature(params, fetchImpl, signal);
      return toolResult(`公开文献检索找到 ${result.papers.length} 篇论文。`, result);
    }),
    tool("add_paper_to_library", "请求加入文献库", "请求用户确认后，把一条论文元数据加入文献库。", async (toolCallId, params) => {
      const paper = {
        title: text(params?.title, 500),
        authors: Array.isArray(params?.authors) ? params.authors.slice(0, 20).map((author) => text(author, 120)).filter(Boolean) : [],
        year: Number.isInteger(params?.year) ? params.year : null,
        doi: text(params?.doi, 500) || undefined,
        landingUrl: normalizeLandingUrl(params?.landingUrl),
        abstract: text(params?.abstract, 20000) || undefined,
        source: text(params?.source, 200) || "Agent",
      };
      if (!paper.title) throw new Error("待加入论文缺少标题");
      const approvalId = randomUUID();
      const result = await emitApproval({ approvalId, toolCallId, paper });
      if (!result?.approved) return toolResult("用户拒绝加入文献库。", { status: "rejected", paper });
      return toolResult(result.message || "论文已加入文献库。", { status: "added", paper, result: result.result });
    }),
    tool("create_document", "生成 Markdown 文档", "展示模型生成的 Markdown 阅读笔记草稿，用户点击保存后才导出文件；本工具不写入磁盘。", async (_id, params) => {
      const title = text(params?.title, 200);
      const markdown = text(params?.markdown, 60000);
      if (!title || !markdown) throw new Error("文档需要标题和模型生成的正文");
      const document = { title, markdown, format: "markdown" };
      return toolResult(`已生成《${document.title}》草稿，尚未保存到磁盘，请用户点击保存草稿。`, { document, saved: false });
    }),
  ];
}

module.exports = { createToolDefinitions, normalizeContext, LIMITS };
