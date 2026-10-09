import type { DocumentBlock } from "../domain/documentBlocks";
import { hasPageBounds } from "../domain/pdfLayout";
import { openPdf } from "./document";
import { loadImageAsset, readOriginalPdf } from "./originalPdf";

export async function loadChartImage(originalId: string | undefined, block: DocumentBlock): Promise<string> {
  if (!originalId) throw new Error("图表原图不可用，请重新导入 PDF");
  if (block.assetPath) {
    try {
      const source = await loadImageAsset(originalId, block.assetPath);
      if (source.length <= 4_000_000) return source;
    } catch {
      // Saved assets may be missing in older imports; the PDF crop is authoritative.
    }
  }
  if (!hasPageBounds(block)) throw new Error("图表原图和定位不可用，请重新进行 MinerU 解析");
  const document = await openPdf(await readOriginalPdf(originalId));
  try {
    const page = await document.getPage(block.pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, 2400 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法读取图表原图");
    await page.render({ canvasContext: context, viewport }).promise;
    const [left, top, right, bottom] = block.bbox!;
    const x = Math.floor(left * canvas.width), y = Math.floor(top * canvas.height);
    const width = Math.ceil(right * canvas.width) - x, height = Math.ceil(bottom * canvas.height) - y;
    const cropped = window.document.createElement("canvas");
    cropped.width = width;
    cropped.height = height;
    const cropContext = cropped.getContext("2d");
    if (!cropContext) throw new Error("无法读取图表原图");
    cropContext.drawImage(canvas, x, y, width, height, 0, 0, width, height);
    const source = cropped.toDataURL("image/png");
    if (source.length > 4_000_000) throw new Error("图表原图过大，请缩小图表范围后重试");
    return source;
  } finally {
    await document.destroy();
  }
}
