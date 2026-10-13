import type { PDFPageProxy } from "pdfjs-dist";

const MAX_CONCURRENT_PAGE_LOADS = 3;

export function createPdfPageLoader(
  document: { getPage: (number: number) => Promise<PDFPageProxy> },
  onPage: (number: number, page: PDFPageProxy) => void,
  onError: (cause: unknown) => void,
) {
  const loaded = new Set([1]);
  const running = new Set<number>();
  const failed = new Set<number>();
  let wanted: number[] = [];
  let disposed = false;

  function pump() {
    if (disposed) return;
    while (running.size < MAX_CONCURRENT_PAGE_LOADS) {
      const number = wanted.find((item) => !loaded.has(item) && !running.has(item) && !failed.has(item));
      if (number === undefined) return;
      running.add(number);
      void Promise.resolve().then(() => document.getPage(number)).then((page) => {
        if (disposed || !wanted.includes(number)) {
          page.cleanup();
          return;
        }
        loaded.add(number);
        onPage(number, page);
      }).catch((cause) => {
        if (!disposed && wanted.includes(number)) {
          failed.add(number);
          onError(cause);
        }
      }).finally(() => {
        running.delete(number);
        pump();
      });
    }
  }

  return {
    request(numbers: number[]) {
      if (disposed) return;
      // Replace obsolete queued work; the first entry is the active navigation target.
      wanted = [...new Set(numbers)];
      pump();
    },
    dispose() {
      disposed = true;
      wanted = [];
    },
  };
}
