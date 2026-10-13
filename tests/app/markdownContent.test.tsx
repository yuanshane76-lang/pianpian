import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
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
