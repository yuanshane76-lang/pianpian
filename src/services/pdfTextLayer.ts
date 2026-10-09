import { TextLayer } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFPageProxy } from "pdfjs-dist";

export function renderPdfTextLayer(page: PDFPageProxy, viewport: ReturnType<PDFPageProxy["getViewport"]>, container: HTMLElement) {
  container.replaceChildren();
  container.style.setProperty("--scale-factor", String(viewport.scale));
  const layer = new TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
  return { promise: layer.render(), cancel: () => layer.cancel() };
}
