import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  createDocumentBlocks,
  type DocumentBlock,
  type ExtractedPage,
} from "../domain/documentBlocks";
import { groupPdfTextItemsIntoParagraphs, type PdfTextItem } from "./pdfText";
import { getStandardFontDataUrl } from "./pdfAssets";

const isBrowserRuntime =
  typeof window !== "undefined" &&
  !window.navigator.userAgent.toLowerCase().includes("jsdom");

if (isBrowserRuntime) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

export function createBlocksFromPlainText(text: string): DocumentBlock[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    ;
  return createDocumentBlocks([{ pageNumber: 1, lines }]);
}

export async function openPdf(data: ArrayBuffer) {
  const standardFontDataUrl = isBrowserRuntime
    ? getStandardFontDataUrl(window.location.href)
    : undefined;
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(data.slice(0)),
    standardFontDataUrl,
  });
  return loadingTask.promise;
}

export async function extractPdfBlocks(data: ArrayBuffer): Promise<DocumentBlock[]> {
  const document = await openPdf(data);
  const pages: ExtractedPage[] = [];
  try {
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = content.items
      .filter((item): item is Extract<typeof item, { str: string }> => "str" in item)
      .map((item) => ({
        str: item.str,
        transform: item.transform,
        width: item.width,
        height: item.height,
        hasEOL: item.hasEOL,
      }));
    const lines = groupPdfTextItemsIntoParagraphs(items);
    pages.push({ pageNumber, lines });
  }

    return createDocumentBlocks(pages);
  } finally {
    await document.destroy();
  }
}
