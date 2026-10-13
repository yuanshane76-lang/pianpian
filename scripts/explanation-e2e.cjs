const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const reproduceThinking = process.argv.includes("--reproduce-thinking");
const output = path.join(root, "out", reproduceThinking ? "explanation-before-checks" : "explanation-checks");
const report = { checks: [], errors: [], requests: [] };

(async () => {
  if (!process.argv.includes("--live-ai")) throw new Error("此脚本调用真实模型并可能计费；请明确传入 --live-ai");
  fs.mkdirSync(output, { recursive: true });
  const electron = await _electron.launch({
    executablePath: require("electron"),
    args: [path.join(__dirname, "reader-chart-launch.cjs")], cwd: root,
    env: { ...process.env, ZHIYAN_E2E_LIVE_AI: "1" },
  });
  const page = await electron.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  try {
    await page.waitForSelector(".workspace-shell");
    const settings = await page.evaluate(() => window.zhiyan.invoke("zhiyan:settings:get"));
    assert(["deepseek", "aliyun"].includes(settings.aiProvider) && settings[settings.aiProvider].configured,
      "A configured model service is required");
    report.provider = settings.aiProvider;
    report.model = settings[settings.aiProvider].model;
    await electron.evaluate((_electron, reproduce) => {
      const originalFetch = globalThis.fetch;
      globalThis.explanationRequests = [];
      globalThis.fetch = async (url, options) => {
        if (!String(url).endsWith("/chat/completions")) return originalFetch(url, options);
        const body = JSON.parse(options.body);
        if (reproduce) {
          delete body.thinking;
          delete body.enable_thinking;
          options = { ...options, body: JSON.stringify(body) };
        }
        const entry = { model: body.model, thinking: body.thinking, enableThinking: body.enable_thinking,
          maxTokens: body.max_tokens, finishes: [], contentCharacters: 0, reasoningCharacters: 0 };
        globalThis.explanationRequests.push(entry);
        const response = await originalFetch(url, options);
        entry.httpStatus = response.status;
        if (!response.ok || !response.body) return response;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const stream = new ReadableStream({
          async pull(controller) {
            try {
              const next = await reader.read();
              if (next.done) { controller.close(); return; }
              buffer += decoder.decode(next.value, { stream: true });
              let newline;
              while ((newline = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (!line.startsWith("data:") || line === "data: [DONE]") continue;
                try {
                  const payload = JSON.parse(line.slice(5).trim());
                  const choice = payload.choices?.[0];
                  if (choice?.finish_reason) entry.finishes.push(choice.finish_reason);
                  if (typeof choice?.delta?.content === "string") entry.contentCharacters += choice.delta.content.length;
                  if (typeof choice?.delta?.reasoning_content === "string") entry.reasoningCharacters += choice.delta.reasoning_content.length;
                } catch {}
              }
              controller.enqueue(next.value);
            } catch (error) { controller.error(error); }
          },
          cancel(reason) { return reader.cancel(reason); },
        });
        return new Response(stream, { status: response.status, headers: response.headers });
      };
    }, reproduceThinking);
    const userData = await electron.evaluate(({ app }) => app.getPath("userData"));
    const directory = path.join(userData, "documents");
    const papers = fs.readdirSync(directory).filter((id) => /^[a-f0-9]{64}$/.test(id)).map((id) => {
      const parsed = JSON.parse(fs.readFileSync(path.join(directory, id, "parse.json"), "utf8"));
      return { id, title: parsed.title, authors: [], year: null, sourcePath: `local://explanation-check/${id}`,
        originalId: id, pageCount: parsed.pageCount, importedAt: "2026-10-09", tags: [], favorite: false,
        blocks: parsed.blocks.length, blockData: parsed.blocks, parseVersion: 2, parseStatus: "ready" };
    });
    const paper = papers.find((item) => item.title.includes("Retrieval-Augmented")) || papers[0];
    const paragraph = paper?.blockData.find((block) => block.kind === "paragraph" && block.bbox && block.pageNumber === 1 && block.text.length > 500)
      || paper?.blockData.find((block) => block.kind === "paragraph" && block.bbox && block.text.length > 150);
    assert(paper && paragraph, "A parsed local paragraph is required");
    report.paper = paper.title;
    report.block = { id: paragraph.id, page: paragraph.pageNumber, inputCharacters: paragraph.text.length };
    await page.evaluate((items) => localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify(items)), papers);
    await page.reload();
    await page.locator(".paper-row").filter({ hasText: paper.title }).first().click();
    await page.getByRole("button", { name: "打开阅读", exact: true }).click();
    await page.getByRole("spinbutton", { name: "PDF 页码" }).fill(String(paragraph.pageNumber));
    await page.locator(`[id="pdf-block-${paragraph.id}"]`).waitFor();
    await page.locator(`[id="pdf-block-${paragraph.id}"]`).click({ force: true });
    const start = Date.now();
    await page.locator('.paragraph-tabs [data-operation="explain"]').click();
    await page.waitForFunction(() => {
      const output = document.querySelector(".assistant-explanation .assistant-copy");
      return /[\u3400-\u9fff]/.test(output?.textContent || "") && !output.textContent.includes("正在生成解释")
        || document.querySelector(".assistant-action-error");
    }, null, { timeout: 120000 });
    report.firstContentMs = Date.now() - start;
    await page.waitForFunction(() => !document.querySelector(".assistant-explanation[aria-busy=true]"), null, { timeout: 120000 });
    report.completeMs = Date.now() - start;
    report.requests = await electron.evaluate(() => globalThis.explanationRequests);
    if (reproduceThinking) {
      const message = await page.locator(".assistant-action-error").textContent();
      assert(message.includes("截断"), "Old thinking-mode parameters reproduce truncation");
      assert(report.requests[0]?.finishes.includes("length"));
      assert(report.requests[0]?.reasoningCharacters > 0);
      report.checks.push("old-parameters-reproduce-truncation", "reasoning-consumed-output-budget");
      await page.screenshot({ path: path.join(output, "before-truncation.png") });
      report.status = "reproduced";
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    assert.equal(await page.locator(".assistant-action-error").count(), 0,
      await page.evaluate(() => document.querySelector(".assistant-action-error")?.textContent || ""));
    const text = await page.locator(".assistant-explanation .assistant-copy").textContent();
    assert(text.length > 50 && /[\u3400-\u9fff]/.test(text), "The explanation contains meaningful Chinese output");
    report.outputCharacters = text.length;
    assert.equal(report.requests.length, 1, "One model call is enough");
    const request = report.requests[0];
    assert(request.thinking?.type === "disabled" || request.enableThinking === false);
    assert(request.finishes.includes("stop"), "The model finishes normally");
    assert.equal(request.reasoningCharacters, 0);
    await page.locator(".assistant-explanation").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "explanation-success.png") });
    report.checks.push("actual-explain-button", "non-thinking-request", "normal-stop-no-truncation", "rendered-complete-explanation");
    assert.deepEqual(report.errors, []);
    report.status = "passed";
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.requests = await electron.evaluate(() => globalThis.explanationRequests || []).catch(() => []);
    report.status = "failed";
    report.error = error.message;
    process.exitCode = 1;
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    console.error(JSON.stringify(report, null, 2));
  } finally {
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    await electron.close();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
