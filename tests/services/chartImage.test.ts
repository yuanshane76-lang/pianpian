import { afterEach, describe, expect, it, vi } from "vitest";
import { loadChartImage } from "../../src/services/chartImage";
import { loadImageAsset, readOriginalPdf } from "../../src/services/originalPdf";
import { openPdf } from "../../src/services/document";

vi.mock("../../src/services/originalPdf", () => ({ loadImageAsset: vi.fn(), readOriginalPdf: vi.fn(async () => new ArrayBuffer(8)) }));
vi.mock("../../src/services/document", () => ({ openPdf: vi.fn() }));
const block = { id: "chart", kind: "image" as const, pageNumber: 2, order: 0, text: "", bbox: [.1, .2, .8, .6] as [number, number, number, number] };
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("local chart image", () => {
  it("uses the saved MinerU image without opening the entire PDF", async () => {
    vi.mocked(loadImageAsset).mockResolvedValueOnce("data:image/png;base64,aGVsbG8=");
    await expect(loadChartImage("original", { ...block, assetPath: "images/chart.png" })).resolves.toBe("data:image/png;base64,aGVsbG8=");
    expect(openPdf).not.toHaveBeenCalled();
  });

  it("falls back to an exact bounded PDF crop and always destroys the temporary document", async () => {
    vi.mocked(loadImageAsset).mockRejectedValueOnce(new Error("missing"));
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,Y3JvcA==");
    const destroy = vi.fn();
    const render = vi.fn((_input: { viewport: { width: number; height: number } }) => ({ promise: Promise.resolve() }));
    vi.mocked(openPdf).mockResolvedValueOnce({
      getPage: vi.fn(async () => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render })),
      destroy,
    } as never);
    await expect(loadChartImage("original", { ...block, assetPath: "missing.png" })).resolves.toContain("Y3JvcA==");
    expect(readOriginalPdf).toHaveBeenCalledWith("original");
    const viewport = render.mock.calls[0][0].viewport;
    expect(drawImage.mock.calls[0].slice(1, 5)).toEqual([Math.floor(viewport.width * .1), Math.floor(viewport.height * .2),
      Math.ceil(viewport.width * .8) - Math.floor(viewport.width * .1), Math.ceil(viewport.height * .6) - Math.floor(viewport.height * .2)]);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("reports unavailable image geometry instead of submitting a guessed full-page screenshot", async () => {
    await expect(loadChartImage("original", { ...block, bbox: undefined })).rejects.toThrow("图表原图");
    expect(openPdf).not.toHaveBeenCalled();
  });
});
