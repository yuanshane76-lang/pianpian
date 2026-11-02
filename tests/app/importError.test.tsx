import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/app/App";
import { DEFAULT_SERVICE_SETTINGS, toPublicServiceSettings } from "../../src/domain/serviceSettings";
import { prepareImportFile } from "../../src/services/library";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("../../src/services/library", async (importActual) => ({
  ...await importActual<typeof import("../../src/services/library")>(),
  prepareImportFile: vi.fn(async () => { throw new Error("不应走到默认导入"); }),
}));

const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
  delete window.zhiyan;
});

async function mountApp() {
  window.zhiyan = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === "zhiyan:settings:get") return toPublicServiceSettings(DEFAULT_SERVICE_SETTINGS);
      return undefined;
    }) as never,
    stream: vi.fn() as never,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<App />));
  return container;
}

async function importFile(container: HTMLElement, name: string) {
  const input = container.querySelector<HTMLInputElement>(".import-button input")!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["synthetic-bytes"], name, { type: "application/pdf" })],
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

function errorBanner(container: HTMLElement) {
  return container.querySelector<HTMLElement>(".import-error");
}

describe("导入失败提示条", () => {
  it("报错带上文件名，并可点击关闭消失", async () => {
    vi.mocked(prepareImportFile).mockImplementationOnce(async () => {
      throw new Error("文件不完整或已损坏（缺少 PDF 结尾），常见原因是下载中断，请重新下载后再导入");
    });
    const container = await mountApp();
    await importFile(container, "2305.16291.pdf");

    const banner = errorBanner(container);
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain("导入失败 2305.16291.pdf");
    expect(banner!.textContent).toContain("文件不完整或已损坏");

    const dismiss = banner!.querySelector<HTMLButtonElement>('[aria-label="关闭导入失败提示"]')!;
    expect(dismiss).not.toBeNull();
    await act(async () => dismiss.click());
    expect(errorBanner(container)).toBeNull();
  });

  it("再次导入成功后提示条自动清除", async () => {
    vi.mocked(prepareImportFile).mockImplementationOnce(async () => {
      throw new Error("Invalid PDF structure.");
    });
    vi.mocked(prepareImportFile).mockImplementationOnce(async () => ({
      paper: {
        id: "ok-paper", originalId: "doc-ok", sourcePath: "local://doc-ok", title: "正常论文",
        authors: [], year: null, importedAt: new Date().toISOString(), groupId: "default",
        favorite: false, blocks: 0, blockData: [], parseStatus: "pending", parseVersion: 2,
        readingPosition: { mode: "pdf", page: 1 },
      },
      data: new ArrayBuffer(8),
      duplicate: false,
    }));
    const container = await mountApp();

    await importFile(container, "坏文件.pdf");
    expect(errorBanner(container)).not.toBeNull();

    await importFile(container, "好文件.pdf");
    expect(errorBanner(container)).toBeNull();
  });
});
