import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/app/App";
import { LibraryView } from "../../src/features/library/LibraryView";
import type { PaperRecord } from "../../src/domain/library";
import type { PaperPipelineState } from "../../src/domain/pipeline";
import { DEFAULT_SERVICE_SETTINGS, toPublicServiceSettings } from "../../src/domain/serviceSettings";
import { preparePdfFile } from "../../src/services/library";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const importedPaper: PaperRecord = {
  id: "mineru-gate-paper",
  title: "待解析论文",
  authors: [],
  year: null,
  sourcePath: "local://mineru-gate-paper",
  originalId: "mineru-gate-document",
  importedAt: "2026-10-10",
  tags: ["待整理"],
  favorite: false,
  blocks: 0,
  blockData: [],
  parseStatus: "pending",
  pageCount: 3,
};

const settings = toPublicServiceSettings({
  ...DEFAULT_SERVICE_SETTINGS,
  aiProvider: "deepseek",
  deepseek: { ...DEFAULT_SERVICE_SETTINGS.deepseek, apiKey: "test" },
  mineru: { ...DEFAULT_SERVICE_SETTINGS.mineru, apiKey: "mineru-test" },
});

vi.mock("../../src/services/library", async (importActual) => ({
  ...await importActual<typeof import("../../src/services/library")>(),
  preparePdfFile: vi.fn(async () => ({ paper: importedPaper, data: new ArrayBuffer(8), duplicate: false })),
}));

vi.mock("../../src/services/originalPdf", () => ({
  readOriginalPdf: vi.fn(async () => new ArrayBuffer(8)),
}));

vi.mock("../../src/features/settings/ServiceSettingsDialog", () => ({
  ServiceSettingsDialog: ({ onSaved }: { onSaved: (value: typeof settings) => void }) =>
    <><button onClick={() => onSaved(settings)}>保存测试配置</button>
      <button onClick={() => onSaved(toPublicServiceSettings(DEFAULT_SERVICE_SETTINGS))}>清除测试配置</button></>,
}));
const mounted: Root[] = [];
afterEach(async () => {
  for (const root of mounted.splice(0)) await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
  document.body.innerHTML = "";
  delete window.zhiyan;
});

async function mountApp(invoke: (channel: string, payload?: unknown) => Promise<unknown>) {
  window.zhiyan = { invoke: vi.fn(invoke) as never, stream: vi.fn() as never };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => root.render(<App />));
  return { container, root };
}

async function importPaper(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>(".import-button input")!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["synthetic"], "paper.pdf", { type: "application/pdf" })] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

const result = {
  blocks: [{ id: "p", kind: "paragraph", pageNumber: 1, order: 0, text: "Body", bbox: [.1, .1, .9, .2] }],
};
const openButton = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('[aria-label="打开阅读"]')!;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function baseLibraryProps(overrides: Partial<React.ComponentProps<typeof LibraryView>> = {}) {
  const pipelineStates: Record<string, PaperPipelineState> = {
    [importedPaper.id]: {
      paperId: importedPaper.id,
      source: "mineru",
      stage: "mineru-processing",
      mineruState: "running",
      mineruProgress: 0.4,
      mineruMessage: "正在解析正文、图表和公式…",
    },
  };
  return {
    papers: [importedPaper],
    selectedPaper: importedPaper,
    selectedId: importedPaper.id,
    query: "",
    filter: "all",
    tags: [],
    errorMessage: null,
    onFilterChange: vi.fn(),
    onQueryChange: vi.fn(),
    onSelect: vi.fn(),
    onImport: vi.fn(async () => undefined),
    onOpenReader: vi.fn(),
    onStartMineru: vi.fn(),
    onToggleFavorite: vi.fn(),
    onUpdateMetadata: vi.fn(),
    onDelete: vi.fn(async () => undefined),
    onOpenSettings: vi.fn(),
    importing: false,
    pipelineStates,
    mineruConfigured: true,
    ...overrides,
  } satisfies React.ComponentProps<typeof LibraryView>;
}

describe("mandatory MinerU reading gate", () => {
  it("uses current configuration if MinerU is cleared while a file is being prepared", async () => {
    const preparation = deferred<Awaited<ReturnType<typeof preparePdfFile>>>();
    vi.mocked(preparePdfFile).mockImplementationOnce(() => preparation.promise);
    const { container } = await mountApp(async (channel) => {
      if (channel === "zhiyan:settings:get") return settings;
      if (channel === "zhiyan:documents:states") return [];
      if (channel === "zhiyan:mineru:start") return { batchId: "batch" };
      if (channel === "zhiyan:mineru:status") return { state: "done", result };
    });
    await importPaper(container);
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("服务配置"))!.click());
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "清除测试配置")!.click());
    await act(async () => preparation.resolve({ paper: importedPaper, data: new ArrayBuffer(8), duplicate: false }));
    expect(vi.mocked(window.zhiyan!.invoke).mock.calls.some(([channel]) => channel === "zhiyan:mineru:start")).toBe(false);
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "保存测试配置")!.click());
    expect(vi.mocked(window.zhiyan!.invoke).mock.calls.filter(([channel]) => channel === "zhiyan:mineru:start")).toHaveLength(1);
    expect(openButton(container).disabled).toBe(false);
  });

  it("starts an import exactly once when settings finish loading while file preparation is pending", async () => {
    const configuration = deferred<typeof settings>();
    const preparation = deferred<Awaited<ReturnType<typeof preparePdfFile>>>();
    vi.mocked(preparePdfFile).mockImplementationOnce(() => preparation.promise);
    const { container } = await mountApp(async (channel) => {
      if (channel === "zhiyan:settings:get") return configuration.promise;
      if (channel === "zhiyan:documents:states") return [];
      if (channel === "zhiyan:mineru:start") return { batchId: "batch" };
      if (channel === "zhiyan:mineru:status") return { state: "done", result };
    });
    await importPaper(container);
    await act(async () => configuration.resolve(settings));
    await act(async () => preparation.resolve({ paper: importedPaper, data: new ArrayBuffer(8), duplicate: false }));
    expect(vi.mocked(window.zhiyan!.invoke).mock.calls.filter(([channel]) => channel === "zhiyan:mineru:start")).toHaveLength(1);
    expect(openButton(container).disabled).toBe(false);
  });

  it("resumes an existing batch after configuration without querying it prematurely or uploading again", async () => {
    window.localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([importedPaper]));
    const task = { state: "pending", batchId: "existing" };
    const { container } = await mountApp(async (channel) => {
      if (channel === "zhiyan:settings:get") return toPublicServiceSettings(DEFAULT_SERVICE_SETTINGS);
      if (channel === "zhiyan:documents:states") return [{ paperId: importedPaper.id, task, result: null }];
      if (channel === "zhiyan:documents:state") return { task, result: null };
      if (channel === "zhiyan:mineru:status") return { state: "done", result };
    });
    expect(vi.mocked(window.zhiyan!.invoke).mock.calls.some(([channel]) => channel === "zhiyan:mineru:status")).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="处理论文"]')!.click());
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "保存测试配置")!.click());
    expect(openButton(container).disabled).toBe(false);
    expect(vi.mocked(window.zhiyan!.invoke).mock.calls.some(([channel]) => channel === "zhiyan:mineru:start")).toBe(false);
  });

  it("ignores a stale initialization snapshot after a newer retry has completed", async () => {
    const snapshot = deferred<unknown[]>();
    window.localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([importedPaper]));
    const { container } = await mountApp(async (channel) => {
      if (channel === "zhiyan:settings:get") return settings;
      if (channel === "zhiyan:documents:states") return snapshot.promise;
      if (channel === "zhiyan:mineru:start") return { batchId: "new-batch" };
      if (channel === "zhiyan:mineru:status") return { state: "done", result };
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="处理论文"]')!.click());
    expect(openButton(container).disabled).toBe(false);
    await act(async () => snapshot.resolve([{ paperId: importedPaper.id, task: { state: "failed", batchId: "old-batch", error: "旧失败" }, result: null }]));
    expect(openButton(container).disabled).toBe(false);
    expect(container.textContent).not.toContain("旧失败");
  });

  it("loads 201 paper snapshots in bounded batches and confirms all completed records", async () => {
    const records = Array.from({ length: 201 }, (_, index) => ({ ...importedPaper, id: `paper-${index}`,
      originalId: `original-${index}`, sourcePath: `local://paper-${index}` }));
    window.localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify(records));
    const { container } = await mountApp(async (channel, payload) => {
      if (channel === "zhiyan:settings:get") return settings;
      if (channel === "zhiyan:documents:states") {
        const items = payload as { paperId: string }[];
        expect(items.length).toBeLessThanOrEqual(200);
        return items.map((item) => ({ paperId: item.paperId, task: { state: "done" }, result }));
      }
    });
    expect(vi.mocked(window.zhiyan!.invoke).mock.calls.filter(([channel]) => channel === "zhiyan:documents:states")).toHaveLength(2);
    expect(container.querySelectorAll(".paper-row")).toHaveLength(201);
    expect(container.querySelectorAll(".paper-row-progress")).toHaveLength(0);
    expect(openButton(container).disabled).toBe(false);
  });

  it("disables reading and shows the MinerU progress on the library page", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push(root);

    await act(async () => root.render(<LibraryView {...baseLibraryProps()} />));

    const openButton = container.querySelector<HTMLButtonElement>('[aria-label="打开阅读"]');
    expect(openButton).not.toBeNull();
    expect(openButton?.disabled).toBe(true);
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("40");
    expect(container.textContent).toContain("正在解析正文、图表和公式");

  });

  it("keeps an imported paper in the library and starts mandatory MinerU parsing", async () => {
    const { container } = await mountApp(async (channel: string) => {
        if (channel === "zhiyan:settings:get") return settings;
        if (channel === "zhiyan:documents:states") return [];
        if (channel === "zhiyan:mineru:start") return { batchId: "mandatory-batch" };
        if (channel === "zhiyan:mineru:status") return {
          state: "running",
          progress: 0.4,
        };
        return undefined;
      });
    await importPaper(container);

    expect(container.querySelector(".reader-shell")).toBeNull();
    expect(container.querySelector(".paper-list")).not.toBeNull();
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(window.zhiyan!.invoke).toHaveBeenCalledWith("zhiyan:mineru:start", importedPaper.originalId);

    expect(openButton(container).disabled).toBe(true);
  });

  it("locks legacy cached ready records until the main process confirms a completed result", async () => {
    window.localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([{ ...importedPaper, parseStatus: "ready", blockData: result.blocks }]));
    const { container } = await mountApp(async (channel) => channel === "zhiyan:settings:get" ? settings : []);
    expect(openButton(container).disabled).toBe(true);
  });

  it("stays locked through upload, conversion and download, then unlocks complete coordinates", async () => {
    vi.useFakeTimers();
    let status: unknown = { state: "running", progress: .4 };
    const { container } = await mountApp(async (channel) => {
      if (channel === "zhiyan:settings:get") return settings;
      if (channel === "zhiyan:documents:states") return [];
      if (channel === "zhiyan:mineru:start") return { batchId: "batch" };
      if (channel === "zhiyan:mineru:status") return status;
    });
    await importPaper(container);
    expect(openButton(container).disabled).toBe(true);
    for (const state of ["converting", "downloading"]) {
      status = { state, progress: 1 };
      await act(async () => vi.advanceTimersByTimeAsync(3000));
      expect(openButton(container).disabled).toBe(true);
      expect(container.querySelector('[role="progressbar"]')?.hasAttribute("aria-valuenow")).toBe(false);
    }
    status = { state: "done", result };
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(openButton(container).disabled).toBe(false);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("keeps missing and partial coordinates locked even when MinerU reports done", async () => {
    const { container } = await mountApp(async (channel) => {
      if (channel === "zhiyan:settings:get") return settings;
      if (channel === "zhiyan:documents:states") return [];
      if (channel === "zhiyan:mineru:start") return { batchId: "batch" };
      if (channel === "zhiyan:mineru:status") return { state: "done", result: {
        blocks: [...result.blocks, { ...result.blocks[0], id: "unpositioned", bbox: undefined }],
      } };
    });
    await importPaper(container);
    expect(openButton(container).disabled).toBe(true);
    expect(container.textContent).toContain("坐标不完整");
    expect(container.querySelector(".is-indeterminate")).toBeNull();
  });

  it("automatically starts a queued import after MinerU is configured", async () => {
    const { container } = await mountApp(async (channel) => {
      if (channel === "zhiyan:settings:get") return toPublicServiceSettings(DEFAULT_SERVICE_SETTINGS);
      if (channel === "zhiyan:documents:states") return [];
      if (channel === "zhiyan:mineru:start") return { batchId: "batch" };
      if (channel === "zhiyan:mineru:status") return { state: "done", result };
    });
    await importPaper(container);
    expect(openButton(container).disabled).toBe(true);
    expect(window.zhiyan!.invoke).not.toHaveBeenCalledWith("zhiyan:mineru:start", importedPaper.originalId);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="处理论文"]')!.click());
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "保存测试配置")!.click());
    expect(window.zhiyan!.invoke).toHaveBeenCalledWith("zhiyan:mineru:start", importedPaper.originalId);
    expect(openButton(container).disabled).toBe(false);
  });

  it("tracks every recovered paper, and stops polling when the app unmounts", async () => {
    vi.useFakeTimers();
    const second = { ...importedPaper, id: "second", originalId: "second-original", sourcePath: "local://second" };
    window.localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([importedPaper, second]));
    const { container, root } = await mountApp(async (channel) => {
      if (channel === "zhiyan:settings:get") return settings;
      if (channel === "zhiyan:documents:states") return [importedPaper, second].map((paper) => ({
        paperId: paper.id, task: { state: "running", batchId: paper.id }, result: null,
      }));
      if (channel === "zhiyan:mineru:status") return { state: "running", progress: .4 };
    });
    expect(window.zhiyan!.invoke).toHaveBeenCalledWith("zhiyan:mineru:status", second.originalId);
    expect(container.querySelectorAll(".paper-row [role=progressbar]")).toHaveLength(2);
    await act(async () => root.unmount());
    mounted.splice(mounted.indexOf(root), 1);
    const count = vi.mocked(window.zhiyan!.invoke).mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(9000));
    expect(vi.mocked(window.zhiyan!.invoke).mock.calls).toHaveLength(count);
  });

  it("does not start a second upload when a running paper is imported again", async () => {
    vi.useFakeTimers();
    const { container } = await mountApp(async (channel) => {
      if (channel === "zhiyan:settings:get") return settings;
      if (channel === "zhiyan:documents:states") return [];
      if (channel === "zhiyan:mineru:start") return { batchId: "batch" };
      if (channel === "zhiyan:mineru:status") return { state: "running", progress: .4 };
    });
    await importPaper(container);
    await importPaper(container);
    expect(preparePdfFile).toHaveBeenCalledTimes(2);
    expect(vi.mocked(window.zhiyan!.invoke).mock.calls.filter(([channel]) => channel === "zhiyan:mineru:start")).toHaveLength(1);
  });
});
