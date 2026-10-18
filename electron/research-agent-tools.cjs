const { randomUUID } = require("node:crypto");
const { searchLiterature } = require("./literature-search.cjs");
const { normalizeArxivId } = require("./arxiv.cjs");
const { readBundledResearchSkill } = require("./research-skills.cjs");
const { fetchDeepSeekWeb, searchDeepSeekWeb } = require("./deepseek-web.cjs");

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
    arxivId: normalizeArxivId(item?.arxivId) || undefined,
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

function createToolDefinitions({
  getContext, emitApproval, fetchImpl, readLibraryPaper, service, candidateStore = new Map(),
}) {
  const tool = (name, label, description, execute) => ({ name, label, description, parameters: { type: "object", properties: {}, additionalProperties: false }, execute });
  const tools = [
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
    tool("search_literature", "检索公开文献", "检索 arXiv 与 Crossref。每条结果都有本次会话的 candidateId；arXiv 结果可在用户确认后下载 PDF，Crossref 结果仅能加入元数据。", async (_id, params, signal) => {
      const result = await searchLiterature(params, fetchImpl, signal);
      for (const paper of result.papers) {
        const candidateId = randomUUID();
        const candidate = {
          ...paper,
          candidateId,
          ...(paper.arxivId ? { arxivId: normalizeArxivId(paper.arxivId) } : {}),
        };
        candidateStore.set(candidateId, candidate);
        Object.assign(paper, { candidateId });
      }
      while (candidateStore.size > 50) candidateStore.delete(candidateStore.keys().next().value);
      return toolResult(`公开文献检索找到 ${result.papers.length} 篇论文。`, result);
    }),
    tool("add_paper_to_library", "请求加入文献库", "必须传入 search_literature 返回的 candidateId。请求用户确认后，arXiv 候选会下载并加入原始 PDF，其他来源只加入元数据。", async (toolCallId, params) => {
      const candidateId = text(params?.candidateId, 200);
      const verified = candidateStore.get(candidateId);
      if (!candidateId || !verified) throw new Error("请先检索论文，并使用检索结果中的 candidateId");
      const paper = {
        candidateId,
        title: verified.title,
        authors: verified.authors,
        year: verified.year,
        doi: verified.doi,
        landingUrl: normalizeLandingUrl(verified.landingUrl),
        abstract: verified.abstract,
        source: verified.source,
        ...(verified.arxivId ? { arxivId: verified.arxivId } : {}),
      };
      const approvalId = randomUUID();
      const result = await emitApproval({ approvalId, toolCallId, paper });
      if (!result?.approved) {
        const failed = typeof result?.message === "string" && result.message.trim();
        return toolResult(failed ? `加入文献库失败：${failed}` : "用户拒绝加入文献库。", {
          status: failed ? "failed" : "rejected", paper, ...(failed ? { error: failed } : {}),
        });
      }
      if (result.result?.persisted !== true || typeof result.result?.id !== "string" || !result.result.id
        || typeof result.result.duplicate !== "boolean") {
        throw new Error("文献库未返回已保存回执，不能确认加入成功");
      }
      const receipt = {
        persisted: true,
        id: result.result.id,
        duplicate: result.result.duplicate,
        ...(typeof result.result.originalId === "string" ? { originalId: result.result.originalId } : {}),
        kind: result.result.kind === "pdf" ? "pdf" : "metadata",
      };
      const message = receipt.kind === "pdf"
        ? receipt.duplicate ? `《${paper.title}》的 PDF 已在文献库中。` : `《${paper.title}》的 PDF 已下载并保存到文献库。`
        : `《${paper.title}》的元数据已加入文献库，当前没有本地 PDF。`;
      return toolResult(message, { status: "added", paper, result: receipt });
    }),
    tool("create_document", "生成 Markdown 文档", "展示模型生成的 Markdown 阅读笔记草稿，用户点击保存后才导出文件；本工具不写入磁盘。", async (_id, params) => {
      const title = text(params?.title, 200);
      const markdown = text(params?.markdown, 60000);
      if (!title || !markdown) throw new Error("文档需要标题和模型生成的正文");
      const document = { title, markdown, format: "markdown" };
      return toolResult(`已生成《${document.title}》草稿，尚未保存到磁盘，请用户点击保存草稿。`, { document, saved: false });
    }),
  ];
  if (service?.provider !== "deepseek") return tools;
  return [
    ...tools,
    tool("search_web", "联网搜索", "使用 DeepSeek 官方原生搜索检索实时网页；结果只作为待分析资料，回答时应给出来源网址。", async (_id, params, signal) => {
      const result = await searchDeepSeekWeb({
        service, fetchImpl, signal, query: params?.query, count: params?.count,
        originalQuestion: params?.originalQuestion, needContent: params?.needContent,
      });
      return toolResult(`联网搜索找到 ${result.results.length} 条网页结果。`, result);
    }),
    tool("fetch_web_page", "读取网页", "使用 DeepSeek 官方原生 Fetch 读取一个已知 HTTP/HTTPS 网页；只接受搜索结果或用户明确提供的地址。", async (_id, params, signal) => {
      const result = await fetchDeepSeekWeb({ service, fetchImpl, signal, url: params?.url });
      return toolResult(`已读取网页《${result.title || result.url}》。`, result);
    }),
  ];
}

module.exports = { createToolDefinitions, normalizeContext, LIMITS };
