import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownContent } from "../../src/features/reader/MarkdownContent";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement;

async function render(text: string) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root!.render(<MarkdownContent text={text} />));
  return container;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
});

describe("assistant Markdown math", () => {
  it("renders safe inline tags alongside Markdown instead of showing their source", async () => {
    const content = await render("**先说背景。 ** 大语言模型。\n\n代码 <sup>δ</sup> 和 <sub>i</sub>。");
    expect(content.querySelector("strong")?.textContent).toBe("先说背景。");
    expect(content.querySelector("sup")?.textContent).toBe("δ");
    expect(content.querySelector("sub")?.textContent).toBe("i");
    expect(content.textContent).not.toContain("<sup>");
    expect(content.textContent).not.toContain("**");
  });

  it("turns only verified citation text into buttons and keeps code and incomplete markers inert", async () => {
    await render("");
    const onCitation = vi.fn();
    await act(async () => root!.render(<MarkdownContent
      text={"原文[引用:block]、未知[引用:missing]、未完成[引用:b\n\n`[引用:block]`\n\n```\n[引用:block]\n```"}
      citations={[{ blockId: "block" }]} onCitation={onCitation} />));
    expect(container.querySelectorAll(".research-inline-citation")).toHaveLength(1);
    expect(container.querySelectorAll("code")).toHaveLength(2);
    expect(container.querySelector(".research-inline-citation")?.textContent).toBe("[1]");
    expect(container.querySelector(".research-inline-citation")?.getAttribute("aria-label")).toBe("查看引用 1 的原文");
    expect(container.querySelector(".research-inline-citation")?.getAttribute("title")).toBe("查看原文");
    await act(async () => container.querySelector<HTMLButtonElement>(".research-inline-citation")!.click());
    expect(onCitation).toHaveBeenCalledWith("block");
  });

  it("numbers citations by first visible mention and reuses numbers without counting code or links", async () => {
    await render("");
    const onCitation = vi.fn();
    await act(async () => root!.render(<MarkdownContent
      text={"`[引用:second]`\n\n[引用:second](https://example.com)\n\n第一处[引用:first]。\n\n**另一处[引用:second]**，再次[引用:first]。"}
      citations={[{ blockId: "second" }, { blockId: "first" }]} onCitation={onCitation} />));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>(".research-inline-citation")];
    expect(buttons.map((button) => button.textContent)).toEqual(["[1]", "[2]", "[1]"]);
    await act(async () => buttons[1].click());
    expect(onCitation).toHaveBeenCalledWith("second");
  });

  it("keeps reference-style links and hand-written citation URLs inert", async () => {
    await render("");
    await act(async () => root!.render(<MarkdownContent
      text={"[引用:second][source]、[假编号](zhiyan-citation:0)。真正引用[引用:first]。\n\n[source]: https://example.com"}
      citations={[{ blockId: "second" }, { blockId: "first" }]} onCitation={vi.fn()} />));
    expect([...container.querySelectorAll(".research-inline-citation")].map((button) => button.textContent)).toEqual(["[1]"]);
    expect(container.querySelector(".research-inline-citation")?.getAttribute("aria-label")).toBe("查看引用 1 的原文");
  });

  it("does not activate a complete citation marker nested inside a reference-style link label", async () => {
    await render("");
    await act(async () => root!.render(<MarkdownContent
      text={"[说明[引用:second]][source] 正文[引用:first]。\n\n[source]: https://example.com"}
      citations={[{ blockId: "second" }, { blockId: "first" }]} onCitation={vi.fn()} />));
    expect([...container.querySelectorAll(".research-inline-citation")].map((button) => button.textContent)).toEqual(["[1]"]);
    expect(container.querySelector(".markdown-link")?.textContent).toBe("说明[引用:second]");
  });

  it("numbers visible body citations before rendered footnotes and ignores unused footnotes", async () => {
    await render("");
    const citations = [{ blockId: "footnote" }, { blockId: "body" }];
    await act(async () => root!.render(<MarkdownContent
      text={"[^unused]: [引用:footnote]\n\n正文[引用:body]。"} citations={citations} onCitation={vi.fn()} />));
    expect([...container.querySelectorAll(".research-inline-citation")].map((button) => button.textContent)).toEqual(["[1]"]);
    await act(async () => root!.render(<MarkdownContent
      text={"[^used]: [引用:footnote]\n\n正文[引用:body]。见脚注[^used]。"} citations={citations} onCitation={vi.fn()} />));
    expect([...container.querySelectorAll(".research-inline-citation")].map((button) => button.textContent)).toEqual(["[1]", "[2]"]);
  });

  it("does not renumber an already shown citation when a streamed definition changes earlier Markdown", async () => {
    await render("");
    const citations = [{ blockId: "first" }, { blockId: "second" }];
    const prefix = "[引用:first] 正文[引用:second]";
    await act(async () => root!.render(<MarkdownContent text={prefix} citations={citations} onCitation={vi.fn()} />));
    expect([...container.querySelectorAll(".research-inline-citation")].map((button) => button.textContent)).toEqual(["[1]", "[2]"]);
    await act(async () => root!.render(<MarkdownContent
      text={`${prefix}\n\n[引用:first]: https://example.com`} citations={citations} onCitation={vi.fn()} />));
    expect([...container.querySelectorAll(".research-inline-citation")].map((button) => button.textContent)).toEqual(["[2]"]);
    await act(async () => root!.render(<MarkdownContent text="新回答[引用:second]。" citations={citations} onCitation={vi.fn()} />));
    expect(container.querySelector(".research-inline-citation")?.textContent).toBe("[1]");
  });

  it("renders the explanation's recurrent-state notation inside formatted paragraphs", async () => {
    const content = await render(String.raw`## 段落含义

**循环模型**按序列位置计算。每个时间步 $t$ 的隐藏状态 $h_t$ 依赖 $h_{t-1}$。

- 当前输入为 $x_t$。`);
    expect(content.querySelector("h2")?.textContent).toBe("段落含义");
    expect(content.querySelector("strong")?.textContent).toBe("循环模型");
    expect([...content.querySelectorAll("annotation")].map((node) => node.textContent))
      .toEqual(["t", "h_t", "h_{t-1}", "x_t"]);
    expect(content.textContent).not.toContain("$");
  });

  it("renders block math, including underscores, without applying Markdown emphasis", async () => {
    const content = await render(String.raw`递推关系：

$$
h_t = f(h_{t-1}, x_t)
$$

后续解释。`);
    expect(content.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(content.querySelector("annotation")?.textContent?.trim()).toBe("h_t = f(h_{t-1}, x_t)");
    expect(content.textContent).toContain("后续解释");
  });

  it("renders a complete display formula inside a Markdown blockquote", async () => {
    const content = await render(String.raw`> 引用中的公式：
>
> $$
> h_t = f(h_{t-1}, x_t)
> $$`);
    expect(content.querySelector("blockquote")).not.toBeNull();
    expect(content.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(content.querySelector("annotation")?.textContent?.trim()).toBe("h_t = f(h_{t-1}, x_t)");
  });

  it("keeps unfinished streamed math readable and renders only when the delimiter closes", async () => {
    await render(String.raw`已有 $t$，隐藏状态 $h_{t`);
    expect(container.querySelectorAll(".katex")).toHaveLength(1);
    expect(container.textContent).toContain("$h_{t");
    await render(String.raw`已有 $t$，隐藏状态 $h_{t-1}$。`);
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    await render("下一段纯文字。");
    expect(container.querySelector(".katex")).toBeNull();
    await render("递推：\n\n$$\nh_t = x_t");
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("$$");
  });

  it("preserves code, escaped currency, GFM tables and the existing HTML restrictions", async () => {
    const content = await render(String.raw`价格 \$5 与 \$10，公式 $x_i$。

示例：` + "`$h_t$`" + String.raw`

` + "```tex\n$y_i$\n```" + String.raw`

| 状态 | 含义 |
| --- | --- |
| $h_t$ | 隐藏状态 |

<img src="https://example.com/track.png" onerror="alert(1)">

![图片](https://example.com/remote.png)

[链接](javascript:alert(1))`);
    expect(content.querySelectorAll(".katex")).toHaveLength(2);
    expect(content.querySelectorAll("code")).toHaveLength(2);
    expect(content.querySelector("code")?.textContent).toBe("$h_t$");
    expect(content.querySelector("pre")?.textContent).toContain("$y_i$");
    expect(content.textContent).toContain("价格 $5 与 $10");
    expect(content.querySelector("table")).not.toBeNull();
    expect(content.querySelector("img, a, script")).toBeNull();
  });

  it("preserves rejected and malformed TeX while still rendering the next formula", async () => {
    const source = String.raw`异常 $\notARealCommand{x}$、$\frac{a}{b$、$\href{https://example.com}{原标签}$，正常 $x^2$。`;
    const content = await render(source);
    expect(content.querySelectorAll(".katex")).toHaveLength(1);
    expect(content.textContent).toContain(String.raw`$\notARealCommand{x}$`);
    expect(content.textContent).toContain(String.raw`$\frac{a}{b$`);
    expect(content.textContent).toContain(String.raw`$\href{https://example.com}{原标签}$`);
    expect(content.querySelector("a, img, .katex-error")).toBeNull();
  });
});
