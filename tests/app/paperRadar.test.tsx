import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderAssistant } from "../../src/features/reader/ReaderAssistant";
import { PaperRadar } from "../../src/features/reader/PaperRadar";

const { loadRelatedPapers } = vi.hoisted(() => ({ loadRelatedPapers: vi.fn() }));
vi.mock("../../src/services/paperRadar", () => ({
  DEFAULT_RADAR_LIMIT: 50,
  loadRelatedPapers,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement;

async function render(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
}

function assistantProps(overrides: Partial<ComponentProps<typeof ReaderAssistant>> = {}) {
  return {
    selectedBlock: null, chartReading: null, onReadChart: vi.fn(), equationReading: null, onReadEquation: vi.fn(),
    answer: null, isBusy: false,
    onTranslate: vi.fn(), onExplain: vi.fn(), explanation: null, onAsk: vi.fn(),
    translation: null, selectionText: "", serviceLabel: "DeepSeek", serviceModel: "deepseek-flash",
    aiAvailable: true, onOpenSettings: vi.fn(), actionError: null, pendingAction: null,
    insight: null, streamingOutput: null, onInsight: vi.fn(), guide: null, onGuide: vi.fn(),
    vocabulary: [], onJump: vi.fn(),
    ...overrides,
  } satisfies ComponentProps<typeof ReaderAssistant>;
}

function tabs() {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
}

function radarPanel() {
  return container.querySelector('[id$="-radar-panel"]');
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.clearAllMocks();
});

describe("paper radar tab", () => {
  it("is absent until a radar panel is provided", async () => {
    await render(<ReaderAssistant {...assistantProps()} />);
    expect(tabs().map((tab) => tab.textContent)).not.toContain("相似论文");
  });

  it("mounts lazily so opening the reader never starts a search", async () => {
    await render(<ReaderAssistant {...assistantProps({ radarPanel: <div>雷达内容</div> })} />);
    const radarTab = tabs().find((tab) => tab.textContent === "相似论文");
    expect(radarTab).toBeTruthy();
    expect(radarPanel()).toBeNull();
    await act(async () => radarTab!.click());
    expect(radarPanel()?.textContent).toBe("雷达内容");
    expect(radarTab!.getAttribute("aria-selected")).toBe("true");
  });

  it("keeps arrow-key navigation working across all four tabs", async () => {
    await render(<ReaderAssistant {...assistantProps({
      radarPanel: <div>雷达内容</div>,
      researchPanel: <div>研究对话内容</div>,
    })} />);
    const order = tabs().map((tab) => tab.textContent);
    expect(order).toHaveLength(4);
    expect(order[2]).toBe("相似论文");
    await act(async () => tabs()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
    await act(async () => tabs()[3].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  });
});

describe("paper radar panel", () => {
  const candidate = {
    id: "doi:10.1/steady",
    title: "SteadySplats: Resampling of Low-Variance Gaussians",
    authors: ["A. Author", "B. Author"],
    year: 2026,
    venue: "CVPR",
    doi: "10.1/steady",
    abstract: "A stochastic rendering method.",
    citationCount: 0,
    source: "Semantic Scholar",
  };

  it("lists candidates with a DOI link and citation count", async () => {
    loadRelatedPapers.mockResolvedValue({ candidates: [candidate], source: "Semantic Scholar", fetchedAt: "2026-10-15T00:00:00.000Z", cached: false });
    await render(<PaperRadar paper={{ title: "Seed Paper", doi: "10.1/seed" }} />);
    expect(container.querySelectorAll(".radar-card")).toHaveLength(1);
    expect(container.querySelector(".radar-candidate-title")?.textContent).toContain("SteadySplats");
    expect(container.querySelector(".radar-actions a")?.getAttribute("href")).toBe("https://doi.org/10.1/steady");
    expect(container.textContent).toContain("被引 0");
  });

  it("surfaces a Chinese error and a retry path when recall fails", async () => {
    loadRelatedPapers.mockRejectedValue(new Error("Semantic Scholar 免费接口限流，请稍后重试。"));
    await render(<PaperRadar paper={{ title: "Seed Paper" }} />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("限流");
    expect(container.querySelector(".radar-summary")).toBeNull();
    loadRelatedPapers.mockResolvedValue({ candidates: [candidate], source: "Semantic Scholar", fetchedAt: "2026-10-15T00:00:00.000Z", cached: true });
    await act(async () => container.querySelector<HTMLButtonElement>(".radar-error .text-button")!.click());
    expect(container.querySelectorAll(".radar-card")).toHaveLength(1);
    expect(container.textContent).toContain("本地缓存");
  });

  it("reports an empty result instead of an empty list", async () => {
    loadRelatedPapers.mockResolvedValue({ candidates: [], source: "Semantic Scholar", fetchedAt: "2026-10-15T00:00:00.000Z", cached: false });
    await render(<PaperRadar paper={{ title: "Seed Paper" }} />);
    expect(container.textContent).toContain("没有找到新的相似工作");
  });
});
