const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "out", "assistant-layout-checks");
const report = { checks: [], errors: [], aiRequests: 0, content: "UI fixtures with a real local PDF; no paid model requests." };

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const electron = await _electron.launch({
    executablePath: require("electron"),
    args: [path.join(__dirname, "reader-chart-launch.cjs")], cwd: root,
  });
  const page = await electron.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  try {
    await page.waitForSelector(".workspace-shell");
    await electron.evaluate(() => {
      globalThis.assistantLayoutAiRequests = 0;
      const fetch = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        if (String(url).includes("/chat/completions")) {
          globalThis.assistantLayoutAiRequests++;
          throw new Error("Layout validation must not call paid AI services");
        }
        return fetch(url, options);
      };
    });
    const userData = await electron.evaluate(({ app }) => app.getPath("userData"));
    const documents = path.join(userData, "documents");
    const papers = fs.readdirSync(documents).filter((id) => /^[a-f0-9]{64}$/.test(id)).map((id) => {
      const parsed = JSON.parse(fs.readFileSync(path.join(documents, id, "parse.json"), "utf8"));
      return { id, title: parsed.title, authors: [], year: null, sourcePath: `local://assistant-layout-check/${id}`,
        originalId: id, pageCount: parsed.pageCount, importedAt: "2026-10-09", tags: [], favorite: false,
        blocks: parsed.blocks.length, blockData: parsed.blocks, parseVersion: 2, parseStatus: "ready" };
    });
    const paper = papers.find((item) => item.title.includes("Retrieval-Augmented")) || papers[0];
    assert(paper, "A real parsed local PDF is required");
    const paragraph = paper.blockData.find((block) => block.kind === "paragraph" && block.bbox && block.text.length > 150);
    const chart = paper.blockData.find((block) => ["image", "table"].includes(block.kind) && block.bbox);
    assert(paragraph && chart, "The PDF contains a paragraph and chart");
    await page.evaluate((items) => localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify(items)), papers);
    await page.reload();
    await page.locator(".paper-row").filter({ hasText: paper.title }).first().click();
    await page.getByRole("button", { name: "打开阅读", exact: true }).click();
    await page.getByRole("spinbutton", { name: "PDF 页码" }).fill(String(paragraph.pageNumber));
    await page.waitForSelector(`[id="pdf-block-${paragraph.id}"]`);
    await page.locator(`[id="pdf-block-${paragraph.id}"]`).click({ force: true });
    await page.waitForFunction(() => document.querySelector(".pdf-preview canvas")?.width > 0 && !document.querySelector(".pdf-feedback"));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForFunction(() => document.querySelector(".reader-document")?.inert === true);
    await page.getByRole("button", { name: "收起助手", exact: true }).click();
    assert.equal(await page.locator(".reader-document").evaluate((element) => element.inert), false);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "展开助手");
    await page.getByRole("button", { name: "展开助手", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".reader-document")?.inert === true);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "tab");
    report.checks.push({ name: "mobile-covered-pdf-inert-and-focus-restored" });
    await page.setViewportSize({ width: 1440, height: 920 });
    await page.waitForFunction(() => document.querySelector(".reader-document")?.inert === false);

    // Mount deterministic states beside the real PDF without writing the user's caches.
    await page.evaluate(async ({ paper, paragraph }) => {
      const React = (await import("/node_modules/.vite/deps/react.js")).default;
      const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
      const { ReaderAssistant } = await import("/src/features/reader/ReaderAssistant.tsx");
      const original = document.querySelector(".reader-assistant");
      original.style.display = "none";
      const host = document.createElement("div");
      host.style.display = "contents";
      original.after(host);
      const fixture = createRoot(host);
      const noop = () => {};
      const base = {
        originalId: paper.id, selectedBlock: paragraph, chartReading: null,
        answer: null, isBusy: false, onTranslate: noop, onExplain: noop, onReadChart: noop,
        explanation: null, translation: "我们在广泛的知识密集型 NLP 任务上微调并评估了模型，并在三个开放域问答任务上达到了当时的最新技术水平，超越了仅依赖参数的 seq2seq 模型，以及针对特定任务的检索与提取架构。\n\n对于语言生成任务，RAG 模型生成的文本比仅依赖参数的 seq2seq 基线更具体、更多样，并且更符合事实。",
        selectionText: "", serviceLabel: "DeepSeek", serviceModel: "deepseek-flash", aiAvailable: true,
        onOpenSettings: noop, actionError: null, pendingAction: null, insight: null, streamingOutput: null,
        onInsight: noop, guide: null, onGuide: noop,
        vocabulary: [
          { term: "retrieval-augmented generation", translation: "检索增强生成", definition: "先检索相关文档，再将文档作为生成模型的上下文。",
            example: "We explore retrieval-augmented generation for knowledge-intensive tasks.", blockId: paragraph.id, pageNumber: paragraph.pageNumber, count: 14, source: "local" },
          { term: "parametric memory", translation: "参数化记忆", definition: "训练后保存在模型参数中的知识。", example: "A pre-trained seq2seq model provides parametric memory.",
            blockId: paragraph.id, pageNumber: paragraph.pageNumber, count: 8, source: "local" },
        ],
        onJump: noop,
      };
      window.renderAssistantFixture = (overrides = {}) => {
        const props = { ...base, ...overrides };
        props.onAsk = (question) => window.renderAssistantFixture({ answer: `本文将外部检索与生成模型结合。问题：${question}` });
        fixture.render(React.createElement(ReaderAssistant, props));
      };
      window.renderAssistantFixture();
    }, { paper, paragraph });
    await page.locator(".reader-assistant:visible .assistant-translation").waitFor();
    const assistant = page.locator(".reader-assistant:visible");
    const scroll = assistant.locator(".assistant-scroll");
    const composer = assistant.locator(".assistant-composer");

    async function capture(name, width, height) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(180);
      const bounds = await assistant.evaluate((element) => {
        const input = element.querySelector("textarea").getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return { outerOverflow: document.documentElement.scrollWidth - innerWidth,
          sidebarOverflow: element.scrollWidth - element.clientWidth,
          visible: rect.width > 0 && rect.height > 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
          sidebarHeight: rect.height, sidebarBottom: rect.bottom, inputBottom: input.bottom,
          composerVisible: input.bottom <= innerHeight && input.top >= rect.top,
          translationFont: getComputedStyle(element.querySelector(".assistant-translation p") || element).fontSize };
      });
      assert(bounds.visible && bounds.composerVisible, `${name}: sidebar and composer must fit`);
      assert(bounds.outerOverflow <= 1 && bounds.sidebarOverflow <= 1, `${name}: no horizontal overflow`);
      await page.screenshot({ path: path.join(output, `${name}.png`) });
      report.checks.push({ name, width, height, bounds });
    }

    await capture("01-translation-desktop", 1440, 920);
    await assistant.screenshot({ path: path.join(output, "sidebar-preview.png") });
    const before = await composer.boundingBox();
    await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const after = await composer.boundingBox();
    assert.equal(before.y, after.y, "Composer stays fixed while results scroll");
    await scroll.evaluate((element) => { element.scrollTop = 0; });
    assert.equal(await assistant.locator(".assistant-original").count(), 0, "Duplicated English original is removed");
    await assistant.getByRole("button", { name: "复制译文", exact: true }).click();
    await assistant.getByRole("button", { name: "已复制译文", exact: true }).waitFor();
    report.checks.push({ name: "fixed-composer-no-original-and-copy" });
    await page.evaluate(() => window.renderAssistantFixture({ insight: { summary: "本段说明 RAG 在知识密集型任务上的实验结果。", role: "通过与参数模型的对照，支持检索增强改善生成质量的结论。" },
      explanation: "知识密集型任务需要模型调用外部事实，例如开放域问答。\n\nRAG 将检索到的文档作为生成上下文；参数记忆与文档记忆共同支持回答。这里的实验结果说明，这种组合不仅提高了问答表现，还改善了生成文本的具体性和事实性。" }));
    await assistant.locator('.paragraph-tabs [data-operation="insight"]').click();
    await assistant.locator(".assistant-insight").waitFor();
    assert.equal(await assistant.locator(".assistant-translation").count(), 0);
    await capture("02a-summary-desktop", 1440, 920);
    await assistant.locator('.paragraph-tabs [data-operation="explain"]').click();
    await assistant.locator(".assistant-explanation").waitFor();
    assert.equal(await assistant.locator(".assistant-insight").count(), 0);
    await capture("02-explanation-desktop", 1440, 920);
    await assistant.locator('.paragraph-tabs [data-operation="translate"]').click();
    await assistant.locator(".assistant-translation").waitFor();
    await capture("03-translation-narrow", 1024, 768);
    await capture("04-translation-mobile", 375, 812);
    await capture("05-translation-landscape", 812, 375);
    await page.getByRole("button", { name: "搜索正文", exact: true }).click();
    await page.evaluate(() => window.renderAssistantFixture({ actionError: "模型请求失败，请检查当前服务配置后重试。" }));
    await capture("05b-error-landscape", 812, 375);
    await page.getByRole("button", { name: "搜索正文", exact: true }).click();
    await page.evaluate(() => window.renderAssistantFixture());
    await page.setViewportSize({ width: 1440, height: 920 });
    await assistant.getByRole("tab", { name: /学术词汇/ }).click();
    await assistant.getByRole("textbox", { name: "搜索学术词汇" }).fill("parametric");
    assert.equal(await assistant.locator(".vocabulary-card").count(), 1, "Vocabulary search works");
    await capture("06-vocabulary", 1440, 920);
    await assistant.getByRole("tab", { name: /读懂这段/ }).click();
    await assistant.getByRole("textbox", { name: "向论文提问" }).fill("论文解决什么问题？");
    await assistant.getByRole("textbox", { name: "向论文提问" }).press("Control+Enter");
    await assistant.locator(".answer-copy").waitFor();
    assert((await assistant.locator(".answer-copy").textContent()).includes("外部检索"));
    report.checks.push({ name: "question-keyboard-send" });
    await page.evaluate(() => window.renderAssistantFixture({ isBusy: true, pendingAction: "translate", translation: "我们在广泛的知识密集型任务上", streamingOutput: { operation: "translate", text: "我们在广泛的知识密集型任务上" } }));
    assert.equal(await assistant.getByRole("button", { name: "复制译文", exact: true }).count(), 0);
    await capture("07-streaming", 1440, 920);
    report.checks.push({ name: "exclusive-three-result-tabs-and-reuse" });
    await page.evaluate(() => window.renderAssistantFixture({ selectedBlock: null, translation: null, aiAvailable: false }));
    await capture("08-empty", 1440, 920);
    await page.evaluate((block) => window.renderAssistantFixture({ selectedBlock: block, translation: null,
      chartReading: { summary: "不同检索增强模型与参数模型的比较。", encoding: "列为评测数据集，行是模型；分数越高表现越好。",
        findings: ["检索增强改善了知识密集型任务的表现。"], role: "为论文的实验结论提供对照。", caveats: ["不同数据集的分数不能直接横向比较。"] } }), chart);
    await assistant.locator(".assistant-chart-preview img").waitFor();
    assert(await assistant.locator(".assistant-chart-preview img").evaluate((image) => image.naturalWidth > 0));
    await capture("09-chart", 1440, 920);
    report.aiRequests = await electron.evaluate(() => globalThis.assistantLayoutAiRequests);
    assert.equal(report.aiRequests, 0);
    assert.deepEqual(report.errors, []);
    report.status = "passed";
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
    process.exitCode = 1;
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    console.error(error.message);
  } finally {
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    await electron.close();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
