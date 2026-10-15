import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VocabularyPanel } from "../../src/features/reader/VocabularyPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLElement }> = [];

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
});

describe("vocabulary panel", () => {
  it("keeps one heading and does not show a page number beside it", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });

    await act(async () => root.render(
      <VocabularyPanel
        terms={[]}
        onJump={vi.fn()}
        onGuide={vi.fn()}
        aiAvailable
        busy={false}
        enriched={false}
        loading={false}
        hasParagraph
      />,
    ));

    expect(container.textContent?.match(/AI 精选本段词汇/g)).toHaveLength(1);
    expect(container.textContent).not.toContain("第 9 页");
    expect(container.querySelector(".vocabulary-heading")?.textContent).toContain("AI 精选本段词汇");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("生成本段词汇"))).toBe(true);
  });
});
