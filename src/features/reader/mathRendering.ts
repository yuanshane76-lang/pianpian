import katex from "katex";

/** Render only supported TeX; retain the original source for invalid or trusted commands. */
export function renderMathHtml(formula: string, display: boolean): string | null {
  try {
    let rejectedTrust = false;
    const html = katex.renderToString(formula, {
      displayMode: display,
      output: "htmlAndMathml",
      trust: () => { rejectedTrust = true; return false; },
      strict: "ignore",
      throwOnError: true,
      maxExpand: 1000,
      maxSize: 10,
    });
    return rejectedTrust ? null : html;
  } catch {
    return null;
  }
}
