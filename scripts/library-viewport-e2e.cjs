const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (process.versions.electron) {
  const { app } = require("electron");
  app.setPath("userData", process.env.ZHIYAN_VIEWPORT_USER_DATA);
  app.setPath("sessionData", path.join(app.getPath("userData"), "session"));
  Object.defineProperty(app, "isPackaged", { value: true });
  globalThis.viewportRemoteRequests = 0;
  globalThis.fetch = async () => {
    globalThis.viewportRemoteRequests++;
    throw new Error("Window layout checks must not call external services");
  };
  require("../electron/main.cjs");
} else {
  const assert = require("node:assert/strict");
  const { _electron } = require("playwright");
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "out", "library-viewport-checks");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "zhiyan-viewport-"));
  const report = { checks: [], errors: [], profile: "isolated synthetic references; no credentials, PDFs or external services" };
  fs.mkdirSync(output, { recursive: true });
  let electron;
  let page;

  function fixtures(count, manyTags = false) {
    return Array.from({ length: count }, (_, index) => ({
      id: `viewport-reference-${index}`,
      recordType: "reference",
      title: index === 0
        ? "FINDEEPRESEARCH: Evaluating Deep Research Agents in Rigorous Financial Analysis"
        : `Synthetic reference ${index + 1}: Research methods and evaluation`,
      authors: [], year: null, sourcePath: "",
      importedAt: "2026-10-13T00:00:00.000Z",
      tags: manyTags ? [`研究标签 ${index + 1}`] : ["待整理"],
      favorite: false, blocks: 0,
    }));
  }

  async function seed(papers) {
    await page.evaluate((items) => {
      localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify(items));
    }, papers);
    await page.reload();
    await page.waitForSelector(".paper-row");
  }

  async function assertControls(label) {
    const measurements = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        const { x, y, width, height } = element.getBoundingClientRect();
        const pointTarget = document.elementFromPoint(x + width / 2, y + height / 2);
        return { x, y, width, height, reachable: !!pointTarget && element.contains(pointTarget) };
      };
      return {
        viewport: { width: innerWidth, height: innerHeight },
        document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        settings: rect(".sidebar-footer button:first-child"),
        theme: rect(".sidebar-footer button:last-child"),
      };
    });
    report.checks.push({ label, measurements });
    await page.screenshot({ path: path.join(output, `${label}.png`) });
    for (const key of ["settings", "theme"]) {
      const control = measurements[key];
      assert(control.x >= 0 && control.y >= 0 &&
        control.x + control.width <= measurements.viewport.width + 1 &&
        control.y + control.height <= measurements.viewport.height + 1 &&
        control.reachable, `${label}: ${key} must be visible and clickable without scrolling`);
    }
    assert(measurements.document.height <= measurements.viewport.height + 1, `${label}: library must not scroll as a whole`);
    assert(measurements.document.width <= measurements.viewport.width + 1, `${label}: library must not overflow horizontally`);
  }

  async function assertIndependentScroll(selector) {
    const result = await page.locator(selector).evaluate((element) => {
      element.scrollTop = 0;
      const overflowing = element.scrollHeight > element.clientHeight;
      element.scrollTop = element.scrollHeight;
      return { overflowing, moved: element.scrollTop > 0, windowScroll: window.scrollY };
    });
    assert(result.overflowing && result.moved && result.windowScroll === 0, `${selector} must scroll independently`);
  }

  (async () => {
    try {
      electron = await _electron.launch({
        executablePath: require("electron"), args: [__filename], cwd: root,
        env: { ...process.env, ZHIYAN_VIEWPORT_USER_DATA: userData },
      });
      page = await electron.firstWindow();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => report.errors.push(error.message));
      await page.waitForSelector(".workspace-shell");
      await page.evaluate(() => window.zhiyan.invoke("zhiyan:settings:save", {
        aiProvider: "deepseek",
        deepseek: { apiKey: "synthetic-model" },
        mineru: { apiKey: "synthetic-parser" },
      }));
      await page.reload();
      await page.waitForSelector(".workspace-shell");
      report.startup = await electron.evaluate(({ BrowserWindow, screen }) => ({
        bounds: BrowserWindow.getAllWindows()[0].getBounds(),
        workArea: screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds()).workArea,
      }));
      await seed(fixtures(4));
      await assertControls("01-initial-window");
      const { bounds, workArea } = report.startup;
      assert(bounds.x >= workArea.x && bounds.y >= workArea.y &&
        bounds.x + bounds.width <= workArea.x + workArea.width &&
        bounds.y + bounds.height <= workArea.y + workArea.height,
      "Initial window must fit the screen work area, including the title bar");

      for (const [width, height] of [[1366, 768], [1280, 720], [980, 680]]) {
        await electron.evaluate(({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0].setSize(...size);
        }, [width, height]);
        const contentSize = await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize());
        await page.waitForFunction((size) => Math.abs(innerWidth - size[0]) <= 1 &&
          Math.abs(innerHeight - size[1]) <= 1, contentSize);
        await assertControls(`02-window-${width}x${height}`);
        await page.getByRole("button", { name: "服务配置", exact: true }).click();
        await page.getByRole("dialog", { name: "服务配置", exact: true }).waitFor();
        await page.getByRole("tab", { name: /论文解析/ }).click();
        assert(await page.locator("#mineru-key").isVisible());
        await page.getByRole("button", { name: "关闭配置", exact: true }).click();
        await page.getByRole("button", { name: "切换为深色模式", exact: true }).click();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
        await assertControls(`03-dark-${width}x${height}`);
        await page.getByRole("button", { name: "切换为浅色模式", exact: true }).click();
      }
      await assertIndependentScroll(".detail-content");
      await seed(fixtures(40, true));
      await assertIndependentScroll(".paper-list");
      await assertIndependentScroll(".group-list");
      await assertControls("04-many-papers-and-groups");
      await page.getByRole("button", { name: "删除分组：研究标签 1", exact: true }).click();
      await page.getByRole("dialog", { name: "删除分组" }).waitFor();
      await page.getByRole("button", { name: "取消删除分组", exact: true }).click();
      await page.getByRole("button", { name: "删除分组：研究标签 1", exact: true }).click();
      await page.getByRole("button", { name: "确认删除分组", exact: true }).click();
      await page.getByRole("button", { name: "分组：默认分组", exact: true }).click();
      await page.locator(".paper-detail-panel").getByRole("heading", { name: "FINDEEPRESEARCH: Evaluating Deep Research Agents in Rigorous Financial Analysis", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "删除分组：研究标签 1", exact: true }).count(), 0);
      const movedPaperGroup = await page.evaluate(() => {
        const papers = JSON.parse(localStorage.getItem("zhiyan-workbench.papers.v1") || "[]");
        return papers.find((paper) => paper.id === "viewport-reference-0")?.groupId;
      });
      assert.equal(movedPaperGroup, "group-inbox");
      await page.getByRole("button", { name: "服务配置", exact: true }).click();
      await page.getByRole("button", { name: "关闭配置", exact: true }).click();

      for (const [width, height] of [[820, 600], [820, 300], [980, 340], [390, 640]]) {
        await page.setViewportSize({ width, height });
        await assertControls(`05-narrow-${width}x${height}`);
        await page.getByRole("button", { name: "服务配置", exact: true }).click();
        await page.getByRole("button", { name: "关闭配置", exact: true }).click();
        await page.getByRole("button", { name: "切换为深色模式", exact: true }).click();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
        await page.getByRole("button", { name: "切换为浅色模式", exact: true }).click();
      }
      report.remoteRequests = await electron.evaluate(() => globalThis.viewportRemoteRequests);
      assert.equal(report.remoteRequests, 0);
      assert.deepEqual(report.errors, []);
      report.status = "passed";
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      report.status = "failed";
      report.error = error.stack;
      if (page) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
      console.error(error.stack);
      process.exitCode = 1;
    } finally {
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
      if (electron) await electron.close();
      const target = fs.realpathSync(userData);
      if (path.dirname(target) !== fs.realpathSync(os.tmpdir()) || !path.basename(target).startsWith("zhiyan-viewport-")) {
        throw new Error("隔离用户目录不在预期临时目录内，拒绝清理");
      }
      fs.rmSync(target, { recursive: true, force: true });
    }
  })().catch((error) => { console.error(error.stack); process.exitCode = 1; });
}
