const { _electron } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "out", "iteration-03-checks");
const paperPath = process.env.PAPERQUAY_E2E_PDF;
const report = {};

(async () => {
  if (!paperPath) throw new Error("请设置 PAPERQUAY_E2E_PDF 后再运行桌面端 E2E 测试");
  if (!fs.existsSync(paperPath)) throw new Error(`测试论文不存在: ${paperPath}`);
  fs.mkdirSync(output, { recursive: true });
  const electron = await _electron.launch({
    executablePath: require("electron"),
    args: [root], cwd: root, timeout: 30000,
  });
  try {
    const page = await electron.firstWindow();
    page.setDefaultTimeout(20000);
    await page.waitForSelector(".workspace-shell");
    report.settings = await page.evaluate(() => window.zhiyan.invoke("zhiyan:settings:get"));
    if (!report.settings.deepseek.configured || !report.settings.mineru.configured) throw new Error("真实测试需要已保存的 DeepSeek 与 MinerU 配置");
    await page.locator('input[type=file]').first().setInputFiles(paperPath);
    await page.waitForSelector(".reader-shell");
    await page.getByRole("button", { name: "原始 PDF", exact: true }).click();
    await page.waitForFunction(() => {
      const canvas = document.querySelector(".pdf-preview canvas");
      return canvas && canvas.width > 0 && !document.querySelector(".pdf-feedback");
    }, null, { timeout: 45000 });
    report.originalPreview = "passed";
    await page.screenshot({ path: path.join(output, "01-original.png") });
    await page.getByRole("button", { name: "MinerU 增强解析", exact: true }).waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector(".reader-processing button:disabled"), null, { timeout: 45000 });
    await page.getByRole("button", { name: "MinerU 增强解析", exact: true }).click();
    const approval = page.getByRole("button", { name: "上传并开始解析", exact: true });
    if (await approval.isVisible()) await approval.click();
    console.log("LIVE: MinerU upload and parsing started");
    const deadline = Date.now() + 10 * 60 * 1000;
    let lastStatus = "";
    while (Date.now() < deadline) {
      const status = await page.locator(".reader-processing").innerText();
      if (status !== lastStatus) { console.log("STATE:", status); lastStatus = status; }
      const error = await page.locator(".assistant-action-error").count();
      if (error) throw new Error(await page.locator(".assistant-action-error").innerText());
      const ready = await page.evaluate(() => {
        const papers = JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1") || "[]");
        const current = papers.find((paper) => paper.originalId && paper.title.toLowerCase().includes("attention"));
        return current && !current.mineruBatchId && current.blockData?.some((block) => block.assetPath)
          ? { id: current.id, title: current.title, pages: current.pageCount, blocks: current.blocks,
              images: current.blockData.filter((block) => block.kind === "image").length,
              tables: current.blockData.filter((block) => block.kind === "table").length,
              equations: current.blockData.filter((block) => block.kind === "equation").length }
          : null;
      });
      if (ready) { report.mineru = ready; break; }
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    if (!report.mineru) throw new Error("MinerU 解析未在测试期限内完成");
    await page.getByRole("button", { name: "阅读版", exact: true }).click();
    const paragraphBlock = page.locator(".document-block.paragraph").filter({ hasText: "The dominant sequence" }).first();
    await paragraphBlock.click();
    const paragraph = await page.locator(".selected-block-text").innerText();
    report.paragraphCharacters = paragraph.length;
    await page.getByRole("button", { name: "翻译整段", exact: true }).click();
    await page.waitForSelector(".assistant-translation", { timeout: 120000 });
    const translation = await page.locator(".assistant-translation p").innerText();
    if (!/[\u3400-\u9fff]/.test(translation)) throw new Error("真实段落翻译没有返回中文");
    report.translation = { source: paragraph, chinese: translation };
    console.log("LIVE: DeepSeek paragraph translation passed");
    console.log("DEBUG selected after translation:", await page.locator(".selected-block-text").count(), await page.locator(".selected-block-text").first().textContent().catch(() => ""));
    await page.getByRole("button", { name: "段落摘要与作用", exact: true }).click();
    await page.waitForSelector(".assistant-insight", { timeout: 120000 });
    report.paragraphInsight = await page.locator(".assistant-insight").innerText();
    console.log("LIVE: DeepSeek paragraph insight passed");
    await page.locator(".assistant-tabs button").nth(1).click();
    const glossaryButton = page.getByRole("button", { name: "AI 补充本文重点术语", exact: true });
    if (await glossaryButton.isVisible()) {
      await glossaryButton.click();
      await page.waitForFunction(() => document.querySelector(".vocabulary-enriched") || document.querySelector(".vocabulary-panel .assistant-action-error"), null, { timeout: 120000 });
    }
    report.vocabulary = {
      count: await page.locator(".vocabulary-card").count(),
      enriched: await page.locator(".vocabulary-enriched").count() > 0,
    };
    console.log("LIVE: vocabulary panel passed");
    await page.locator(".assistant-tabs button").first().click();
    await page.screenshot({ path: path.join(output, "02-paragraph-translation.png") });
    const target = paragraphBlock;
    await target.evaluate((element) => {
      const node = element.querySelector(".block-body > p").firstChild;
      const range = document.createRange();
      const text = node.textContent;
      const end = text.indexOf(". ") >= 0 ? text.indexOf(". ") + 1 : Math.min(text.length, 90);
      range.setStart(node, 0); range.setEnd(node, end);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await page.getByRole("button", { name: "翻译选中句子", exact: true }).click();
    await page.waitForSelector(".assistant-translation", { timeout: 120000 });
    report.sentenceTranslation = await page.locator(".assistant-translation p").innerText();
    await page.locator(".figure-image-button").first().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const image = document.querySelector(".figure-image-button img");
      return image && image.complete && image.naturalWidth > 0;
    });
    await page.locator(".figure-image-button").first().click();
    await page.getByRole("dialog", { name: "图表放大预览" }).waitFor();
    await page.screenshot({ path: path.join(output, "03-figure.png") });
    await page.getByRole("button", { name: "关闭图表预览" }).click();
    report.figurePreview = "passed";
    await page.getByRole("textbox", { name: "向论文提问" }).fill("请用两句话说明这篇论文的核心贡献，并注明依据的页码。");
    await page.getByRole("button", { name: "发送问题" }).click();
    await page.waitForSelector(".answer-copy", { timeout: 120000 });
    report.answer = await page.locator(".answer-copy").innerText();
    console.log("LIVE: DeepSeek paper Q&A passed");
    await page.screenshot({ path: path.join(output, "04-reading.png") });
    await page.reload();
    await page.waitForSelector(".workspace-shell");
    await page.locator(".paper-row").filter({ hasText: "Attention" }).first().click();
    await page.getByRole("button", { name: "打开阅读", exact: true }).click();
    report.restoredMode = await page.locator(".reader-mode-switch .is-selected").innerText();
    await page.getByRole("button", { name: "原始 PDF", exact: true }).click();
    await page.waitForFunction(() => {
      const canvas = document.querySelector(".pdf-preview canvas");
      return canvas?.width > 0 && !document.querySelector(".pdf-feedback");
    });
    report.originalAfterReload = "passed";
    report.status = "passed";
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.status = "failed"; report.error = error.message;
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.error(error.message);
    process.exitCode = 1;
    const page = await electron.firstWindow().catch(() => null);
    if (page) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  } finally { await electron.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
