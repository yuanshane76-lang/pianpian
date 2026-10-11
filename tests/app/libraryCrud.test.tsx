import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/app/App";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const paper = {
  id: "crud-paper",
  title: "原始标题",
  authors: ["原作者"],
  year: null,
  sourcePath: "local://crud-paper",
  originalId: "crud-document",
  importedAt: "2026-10-07",
  tags: ["待整理"],
  favorite: false,
  blocks: 1,
  blockData: [{ id: "p001-b001", kind: "paragraph", pageNumber: 1, order: 0, text: "A paragraph." }],
};

vi.mock("../../src/services/originalPdf", () => ({
  deleteOriginalPdf: vi.fn(async () => undefined),
  readOriginalPdf: vi.fn(async () => new ArrayBuffer(0)),
}));

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
  delete window.zhiyan;
});

async function mount() {
  window.localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify([paper]));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<App />));
  return { container, root };
}

describe("library CRUD interactions", () => {
  it("edits paper metadata from the detail panel and persists it", async () => {
    const { container, root } = await mount();
    await act(async () => (container.querySelector('[aria-label="编辑文献"]') as HTMLButtonElement).click());

    const title = container.querySelector<HTMLInputElement>("#paper-title")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "更新后的标题");
      title.dispatchEvent(new Event("input", { bubbles: true }));
      (container.querySelector('[aria-label="保存文献"]') as HTMLButtonElement).click();
    });

    expect(container.textContent).toContain("更新后的标题");
    expect(JSON.parse(window.localStorage.getItem("zhiyan-workbench.papers.v1")!)[0].title).toBe("更新后的标题");
    await act(async () => root.unmount());
  });

  it("deletes a paper only after explicit confirmation", async () => {
    const { container, root } = await mount();
    await act(async () => (container.querySelector('[aria-label="删除文献"]') as HTMLButtonElement).click());
    expect(container.querySelector('[role="dialog"][aria-label="删除文献"]')).not.toBeNull();

    await act(async () => (container.querySelector('[aria-label="确认删除文献"]') as HTMLButtonElement).click());
    expect(container.textContent).toContain("文献库还是空的");
    expect(JSON.parse(window.localStorage.getItem("zhiyan-workbench.papers.v1")!)).toEqual([]);
    await act(async () => root.unmount());
  });
});
