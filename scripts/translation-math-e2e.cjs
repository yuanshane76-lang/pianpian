const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (process.versions.electron) {
  const { app } = require("electron");
  app.setPath("userData", process.env.ZHIYAN_MATH_E2E_USER_DATA);
  app.setPath("sessionData", path.join(process.env.ZHIYAN_MATH_E2E_USER_DATA, "session"));
  require("../electron/main.cjs");
} else {
  const { _electron } = require("playwright");
  const assert = require("node:assert/strict");
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "out", "translation-math-checks");
  const report = { checks: [], errors: [], aiRequests: 0, content: "Deterministic translation fixtures in an isolated desktop profile; no paid requests or user cache writes." };
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "zhiyan-math-e2e-"));
  fs.mkdirSync(path.join(userData, "session"));

  (async () => {
    fs.mkdirSync(output, { recursive: true });
    const electron = await _electron.launch({
      executablePath: require("electron"),
      args: [__filename], cwd: root,
      env: { ...process.env, ZHIYAN_MATH_E2E_USER_DATA: userData },
    });
    const page = await electron.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => report.errors.push(error.message));
    try {
      await page.waitForSelector(".workspace-shell");
      await electron.evaluate(() => {
        globalThis.translationMathAiRequests = 0;
        const fetch = globalThis.fetch;
        globalThis.fetch = async (url, options) => {
          if (String(url).includes("/chat/completions")) {
            globalThis.translationMathAiRequests++;
            throw new Error("Math rendering checks must not call paid AI services");
          }
          return fetch(url, options);
        };
      });
      await page.evaluate(async () => {
        const React = (await import("/node_modules/.vite/deps/react.js")).default;
        const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
        const { ReaderAssistant } = await import("/src/features/reader/ReaderAssistant.tsx");
        document.getElementById("root").style.display = "none";
        const host = document.createElement("div");
        host.style.cssText = "position:fixed;top:0;right:0;width:min(380px,100vw);height:100dvh;z-index:100;display:flex;background:white;";
        document.body.append(host);
        const fixture = createRoot(host);
        const noop = () => {};
        const base = {
          selectedBlock: { id: "math-p1", kind: "paragraph", pageNumber: 3, order: 0, text: "The generator component can be modeled using any encoder-decoder." },
          originalId: "fixture", chartReading: null, onReadChart: noop,
          answer: null, isBusy: false, onTranslate: noop,
          onExplain: noop, explanation: null, onAsk: noop, selectionText: "",
          serviceLabel: "DeepSeek", serviceModel: "deepseek-flash", aiAvailable: true,
          onOpenSettings: noop, actionError: null, pendingAction: null, insight: null,
          streamingOutput: null, onInsight: noop, guide: null, onGuide: noop, vocabulary: [],
          onJump: noop,
          translation: String.raw`生成器组件 $p _ { \theta } ( y _ { i } | x , z , y _ { 1 : i - 1 } )$ 可以采用任意编码器-解码器进行建模。我们使用的是 BART-large [32]，这是一个预训练的序列到序列变换器 [58]，拥有4亿参数。为了在从 BART 生成时结合输入 $x$ 与检索到的内容 $z$，我们简单地将它们拼接起来。BART 通过去噪目标及多种不同的噪声函数进行了预训练。它在众多生成任务上取得了最先进的结果，并且优于同等规模的 T5 模型 [32]。此后，我们将 BART 生成器参数 $\theta$ 称为参数化记忆。`,
        };
        window.renderMathFixture = (overrides = {}) => fixture.render(React.createElement(ReaderAssistant, { ...base, ...overrides }));
        window.renderMathFixture();
      });
      const assistant = page.locator(".reader-assistant");
      const content = assistant.locator(".translation-content");
      await content.locator(".katex").first().waitFor();
      assert.equal(await content.locator(".katex").count(), 4);
      await page.evaluate(() => document.fonts.ready);
      const fonts = await page.evaluate(() => document.fonts.check('16px "KaTeX_Main"') && document.fonts.check('16px "KaTeX_Math"'));
      assert(fonts, "Bundled math fonts must load");
      report.checks.push({ name: "screenshot-formula-and-local-fonts" });

      async function capture(name, width, height) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const bounds = await assistant.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const input = element.querySelector("textarea").getBoundingClientRect();
          const formulas = [...element.querySelectorAll(".translation-content > span")];
          return {
            outerOverflow: document.documentElement.scrollWidth - innerWidth,
            sidebarOverflow: element.scrollWidth - element.clientWidth,
            contentOverflow: element.querySelector(".translation-content").scrollWidth - element.querySelector(".translation-content").clientWidth,
            textFont: getComputedStyle(element.querySelector(".translation-content")).fontSize,
            mathFont: getComputedStyle(element.querySelector(".katex")).fontSize,
            visible: rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
            composerVisible: input.top >= rect.top && input.bottom <= innerHeight + 1,
            formulas: formulas.map((formula) => ({
              width: formula.getBoundingClientRect().width,
              scrollable: formula.scrollWidth > formula.clientWidth,
              overflow: getComputedStyle(formula).overflowX,
            })),
          };
        });
        report.checks.push({ name, width, height, bounds });
        assert(bounds.visible && bounds.composerVisible, `${name}: panel and composer must fit`);
        assert(bounds.outerOverflow <= 1 && bounds.sidebarOverflow <= 1 && bounds.contentOverflow <= 1, `${name}: formulas must not widen the panel`);
        await assistant.screenshot({ path: path.join(output, `${name}.png`) });
        return bounds;
      }

      await capture("01-inline-desktop", 1440, 920);
      await assistant.locator(".assistant-translation").screenshot({ path: path.join(output, "translation-preview.png") });
      await capture("02-inline-narrow", 1024, 768);
      await capture("03-inline-mobile", 375, 812);
      await capture("04-inline-small-mobile", 320, 812);

      const displayText = String.raw`生成概率：
$$p_{\theta}(y \mid x) = \sum_{z \in \mathcal{Z}} p_{\eta}(z \mid x) \prod_{i=1}^{N} p_{\theta}(y_i \mid x,z,y_{1:i-1}) + \lambda\sum_{j=1}^{M}\lVert h_j-\hat h_j\rVert_2^2$$
分数为 \(\frac{a_i}{b_i}\)。
\[\theta = \frac{1}{n}\sum_{i=1}^{n} x_i^2\]`;
      await page.evaluate((translation) => window.renderMathFixture({ translation }), displayText);
      await content.locator(".katex-display").first().waitFor();
      assert.equal(await content.locator(".katex-display").count(), 2);
      const longBounds = await capture("05-display-mobile", 375, 812);
      assert(longBounds.formulas.some((formula) => formula.scrollable && formula.overflow === "auto"), "Long formula has its own horizontal scroller");
      const moved = await content.locator(".translation-math-display").first().evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
        return element.scrollLeft > 0;
      });
      assert(moved, "The formula can actually scroll to reveal its right-hand side");
      await capture("06-display-landscape", 812, 375);

      await page.evaluate(() => window.renderMathFixture({ translation: String.raw`已有 $x_i$，生成器 $p_{\theta}`, pendingAction: "translate", isBusy: true }));
      await page.waitForFunction(() => document.querySelectorAll(".translation-content .katex").length === 1);
      assert((await content.textContent()).includes(String.raw`$p_{\theta}`));
      assert.equal(await assistant.locator('[aria-label="复制译文"]').count(), 0);
      await page.evaluate(() => window.renderMathFixture({ translation: String.raw`已有 $x_i$，生成器 $p_{\theta}(y_i)$。`, pendingAction: "translate", isBusy: true }));
      await page.waitForFunction(() => document.querySelectorAll(".translation-content .katex").length === 2);
      await capture("07-streaming-complete-formula", 375, 812);
      await page.evaluate(() => window.renderMathFixture({ translation: String.raw`<img src=x onerror=alert(1)> 异常 $\notARealCommand{x}$，正常 $x_i$。` }));
      await page.waitForFunction(() => document.querySelectorAll(".translation-content .katex").length === 1 && document.querySelector(".translation-content").textContent.includes("notARealCommand"));
      assert.equal(await content.locator("img").count(), 0);
      assert.equal(await content.locator(".katex-error").count(), 0);
      report.checks.push({ name: "streaming-and-literal-fallback-no-html" });
      await page.evaluate(() => window.renderMathFixture({ translation: String.raw`正文 \(\frac{\frac{a_i+b_i}{c_i}}{\sqrt{d_i+e_i}}\) 继续阅读。` }));
      await content.locator(".mfrac").first().waitFor();
      const clipping = await content.locator(".translation-math").evaluate((element) => {
        const wrapper = element.getBoundingClientRect();
        const html = element.querySelector(".katex-html");
        const walker = document.createTreeWalker(html, NodeFilter.SHOW_TEXT);
        const glyphs = [];
        while (walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          const rect = range.getBoundingClientRect();
          if (rect.width && rect.height) glyphs.push({ top: rect.top, bottom: rect.bottom });
        }
        return { wrapper: { top: wrapper.top, bottom: wrapper.bottom }, glyphs };
      });
      report.checks.push({ name: "tall-fraction-clipping-bounds", clipping });
      assert(clipping.glyphs.length > 0);
      assert(clipping.glyphs.every((glyph) => glyph.top >= clipping.wrapper.top - 1 && glyph.bottom <= clipping.wrapper.bottom + 1), "Tall inline fractions must not clip their visible glyphs");
      await capture("08-tall-inline-fraction", 375, 812);
      report.checks.push({ name: "tall-fraction-not-clipped-and-long-formula-scrolls", clipping });
      report.aiRequests = await electron.evaluate(() => globalThis.translationMathAiRequests);
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
}
