import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/app/App";
import { DEFAULT_SERVICE_SETTINGS, toPublicServiceSettings } from "../../src/domain/serviceSettings";
import type { ResearchAgentImportReceipt, ResearchAgentPaperSummary } from "../../src/services/researchAgentProtocol";
import { prepareImportFile } from "../../src/services/library";
import { addLiteraturePaper, upgradeLiteraturePaperWithPdf } from "../../src/domain/literature";

type ImportPaper = (paper: ResearchAgentPaperSummary, signal: AbortSignal) => Promise<ResearchAgentImportReceipt>;
const assistant = vi.hoisted(() => ({ importPaper: undefined as ImportPaper | undefined }));

vi.mock("../../src/features/reader/ResearchAssistant", () => ({
  ResearchAssistant: ({ onAddPaper }: { onAddPaper: ImportPaper }) => {
    assistant.importPaper = onAddPaper;
    return null;
  },
}));
vi.mock("../../src/services/library", async (importActual) => ({
  ...await importActual<typeof import("../../src/services/library")>(),
  prepareImportFile: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const paper: ResearchAgentPaperSummary = {
  title: "Attention Is All You Need", authors: ["Synthetic author"], year: 2017,
  arxivId: "1706.03762v7", candidateId: "verified-synthetic-candidate",
};
const mounted: Root[] = [];

afterEach(async () => {
  for (const root of mounted.splice(0)) await act(async () => root.unmount());
  assistant.importPaper = undefined;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
  delete window.zhiyan;
});

async function mount(invoke: (channel: string, payload?: unknown) => Promise<unknown>, openAssistant = true) {
  window.zhiyan = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === "zhiyan:settings:get") return toPublicServiceSettings(DEFAULT_SERVICE_SETTINGS);
      if (channel === "zhiyan:documents:states") return [];
      return invoke(channel, payload);
    }) as never,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => root.render(<App />));
  if (openAssistant) await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="问问篇篇"]')!.click());
  return window.zhiyan.invoke;
}

describe("research paper import cancellation", () => {
  it("keeps an upgraded reference identity and user fields when its PDF is manually imported again", async () => {
    const reference = addLiteraturePaper([], paper).papers[0];
    const organized = { ...reference, groupId: "custom-group", favorite: true };
    const prepared = {
      ...reference, id: "document-hash", originalId: "document-hash", sourcePath: "local://document-hash",
      recordType: undefined, parseStatus: "pending" as const, blocks: 0, blockData: [],
    };
    const upgraded = upgradeLiteraturePaperWithPdf([organized], paper, prepared);
    window.localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify(upgraded.papers));
    window.localStorage.setItem("zhiyan-workbench.groups.v1", JSON.stringify([
      { id: "custom-group", name: "阅读中", createdAt: "2026-10-17" },
    ]));
    vi.mocked(prepareImportFile).mockResolvedValueOnce({ paper: prepared, data: new ArrayBuffer(8), duplicate: true });
    await mount(async () => undefined, false);
    const input = document.querySelector<HTMLInputElement>(".import-button input")!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["synthetic"], "paper.pdf")] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    const persisted = JSON.parse(window.localStorage.getItem("zhiyan-workbench.papers.v1")!);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ id: reference.id, originalId: "document-hash", favorite: true, groupId: "custom-group" });
  });

  it.each([false, true])("cleans up only newly saved PDFs when cancellation occurs during download (duplicate=%s)", async (duplicate) => {
    let finish!: (value: { id: string; name: string; duplicate: boolean; importId: string }) => void;
    const download = new Promise<{ id: string; name: string; duplicate: boolean; importId: string }>((resolve) => { finish = resolve; });
    const invoke = await mount(async (channel) => {
      if (channel === "zhiyan:literature:download-arxiv") return download;
    });
    const controller = new AbortController();
    const importing = assistant.importPaper!(paper, controller.signal);
    const rejection = expect(importing).rejects.toThrow("加入文献已取消");
    controller.abort();
    finish({ id: "synthetic-document", name: "paper.pdf", duplicate, importId: "managed-import" });
    await act(async () => { await rejection; });

    expect(invoke).not.toHaveBeenCalledWith("zhiyan:documents:read", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("zhiyan:documents:delete", expect.anything());
    expect(invoke).toHaveBeenCalledWith("zhiyan:literature:finish-import", { importId: "managed-import", retained: false });
    expect(JSON.parse(window.localStorage.getItem("zhiyan-workbench.papers.v1") ?? "[]")).toEqual([]);
  });
});
