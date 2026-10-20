import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/app/App";
import { DEFAULT_GROUP_ID, DEFAULT_GROUP_NAME } from "../../src/domain/library";
import { PaperEditDialog } from "../../src/features/library/PaperEditDialog";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const paper = {
  id: "crud-paper",
  title: "原始标题",
  authors: ["原作者"],
  year: null,
  sourcePath: "local://crud-paper",
  originalId: "crud-document",
  importedAt: "2026-10-07",
  groupId: "group-inbox",
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

async function mount(options: {
  papers?: typeof paper[];
  groups?: { id: string; name: string; createdAt: string }[];
} = {}) {
  window.localStorage.setItem("zhiyan-workbench.papers.v1", JSON.stringify(options.papers ?? [paper]));
  if (options.groups) window.localStorage.setItem("zhiyan-workbench.groups.v1", JSON.stringify(options.groups));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<App />));
  return { container, root };
}

describe("library CRUD interactions", () => {
  it("keeps the group draft and original selection when creation fails, allowing a retry", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onCreateGroup = vi.fn().mockImplementationOnce(() => { throw new Error("分组保存失败"); })
      .mockReturnValue({ id: "group-new", name: "研究方法" });
    await act(async () => root.render(<PaperEditDialog paper={{ ...paper, blockData: [] }} groups={[{ id: "group-inbox", name: DEFAULT_GROUP_NAME, createdAt: "2026-10-16" }, { id: "group-new", name: "研究方法", createdAt: "2026-10-16" }]} onCreateGroup={onCreateGroup} onClose={vi.fn()} onSave={vi.fn()} />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="在编辑文献中创建分组"]')!.click());
    const name = container.querySelector<HTMLInputElement>('[aria-label="新分组名称"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "研究方法");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="确认创建分组"]')!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("分组保存失败");
    expect(name.value).toBe("研究方法");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="确认创建分组"]')!.click());
    expect(container.querySelector<HTMLSelectElement>("#paper-group")!.value).toBe("group-new");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it("creates and selects a group inline without opening a second dialog", async () => {
    const { container, root } = await mount();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="编辑文献"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="在编辑文献中创建分组"]')!.click());
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    const name = container.querySelector<HTMLInputElement>('[aria-label="新分组名称"]')!;
    expect(name).toBe(document.activeElement);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="保存文献"]')!.disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="确认创建分组"]')!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("分组名称");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "每周组会");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(container.querySelector<HTMLSelectElement>("#paper-group")!.selectedOptions[0].text).toBe("每周组会");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="保存文献"]')!.click());
    expect(JSON.parse(window.localStorage.getItem("zhiyan-workbench.papers.v1")!)[0].groupId).toBe("group-每周组会");
    await act(async () => root.unmount());
  });

  it("cancels inline group creation with Escape and keeps the original selection", async () => {
    const { container, root } = await mount();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="编辑文献"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="在编辑文献中创建分组"]')!.click());
    const name = container.querySelector<HTMLInputElement>('[aria-label="新分组名称"]')!;
    await act(async () => name.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector<HTMLSelectElement>("#paper-group")!.value).toBe("group-inbox");
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.activeElement).toBe(container.querySelector('[aria-label="在编辑文献中创建分组"]'));
    await act(async () => root.unmount());
  });

  it("creates a group, assigns the paper to it, and filters by the group", async () => {
    const { container, root } = await mount();
    await act(async () => (container.querySelector('[aria-label="创建分组"]') as HTMLButtonElement).click());
    const groupName = container.querySelector<HTMLInputElement>("#group-name")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(groupName, "AI 论文");
      groupName.dispatchEvent(new Event("input", { bubbles: true }));
      (container.querySelector('[aria-label="保存分组"]') as HTMLButtonElement).click();
    });

    expect(container.textContent).toContain("AI 论文");
    await act(async () => (container.querySelector('[aria-label="编辑文献"]') as HTMLButtonElement).click());
    const group = container.querySelector<HTMLSelectElement>("#paper-group")!;
    await act(async () => {
      group.value = "group-AI 论文";
      group.dispatchEvent(new Event("change", { bubbles: true }));
      (container.querySelector('[aria-label="保存文献"]') as HTMLButtonElement).click();
    });

    expect(JSON.parse(window.localStorage.getItem("zhiyan-workbench.papers.v1")!)[0].groupId).toBe("group-AI 论文");
    await act(async () => (container.querySelector('[aria-label="分组：AI 论文"]') as HTMLButtonElement).click());
    expect(container.querySelectorAll(".paper-row")).toHaveLength(1);
    await act(async () => root.unmount());
  });

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
    expect(container.textContent).toContain("暂时没有文献");
    expect(JSON.parse(window.localStorage.getItem("zhiyan-workbench.papers.v1")!)).toEqual([]);
    await act(async () => root.unmount());
  });

  it("deletes a custom group only after confirmation and returns its papers to the default group", async () => {
    const customPaper = { ...paper, groupId: "group-ai" };
    const { container, root } = await mount({
      papers: [customPaper],
      groups: [
        { id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, createdAt: "" },
        { id: "group-ai", name: "AI 论文", createdAt: "2026-10-16" },
      ],
    });

    expect(container.querySelector(`[aria-label="删除分组：${DEFAULT_GROUP_NAME}"]`)).toBeNull();
    expect(container.textContent).toContain(DEFAULT_GROUP_NAME);
    await act(async () => (container.querySelector('[aria-label="分组：AI 论文"]') as HTMLButtonElement).click());
    expect(container.querySelectorAll(".paper-row")).toHaveLength(1);
    await act(async () => (container.querySelector(`[aria-label="删除分组：AI 论文"]`) as HTMLButtonElement).click());
    expect(container.querySelector('[role="dialog"][aria-label="删除分组"]')).not.toBeNull();
    expect(container.textContent).toContain("组内论文会移到“默认分组”");

    await act(async () => (container.querySelector('[aria-label="取消删除分组"]') as HTMLButtonElement).click());
    expect(container.querySelector('[role="dialog"][aria-label="删除分组"]')).toBeNull();
    expect(container.querySelector('[aria-label="分组：AI 论文"]')).not.toBeNull();

    await act(async () => (container.querySelector(`[aria-label="删除分组：AI 论文"]`) as HTMLButtonElement).click());
    await act(async () => (container.querySelector('[aria-label="确认删除分组"]') as HTMLButtonElement).click());

    expect(container.querySelector('[aria-label="分组：AI 论文"]')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("zhiyan-workbench.groups.v1")!)).toEqual([
      { id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, createdAt: "" },
    ]);
    expect(JSON.parse(window.localStorage.getItem("zhiyan-workbench.papers.v1")!)[0].groupId).toBe(DEFAULT_GROUP_ID);
    expect(container.querySelectorAll(".paper-row")).toHaveLength(1);
    expect(container.querySelector(`[aria-label="分组：${DEFAULT_GROUP_NAME}"]`)?.className).toContain("is-active");
    await act(async () => root.unmount());
  });

  it("keeps the group and paper assignment when saving a group deletion fails", async () => {
    const customPaper = { ...paper, groupId: "group-ai" };
    const { container, root } = await mount({
      papers: [customPaper],
      groups: [
        { id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, createdAt: "" },
        { id: "group-ai", name: "AI 论文", createdAt: "2026-10-16" },
      ],
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === "zhiyan-workbench.groups.v1") throw new Error("storage full");
      setItem.call(this, key, value);
    });

    await act(async () => (container.querySelector('[aria-label="删除分组：AI 论文"]') as HTMLButtonElement).click());
    await act(async () => (container.querySelector('[aria-label="确认删除分组"]') as HTMLButtonElement).click());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("分组删除失败");
    expect(container.querySelector('[aria-label="分组：AI 论文"]')).not.toBeNull();
    expect(JSON.parse(window.localStorage.getItem("zhiyan-workbench.groups.v1")!)).toHaveLength(2);
    expect(JSON.parse(window.localStorage.getItem("zhiyan-workbench.papers.v1")!)[0].groupId).toBe("group-ai");
    await act(async () => root.unmount());
  });
});
