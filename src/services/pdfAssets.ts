export function getStandardFontDataUrl(pageUrl: string): string {
  return new URL("./standard_fonts/", pageUrl).toString();
}
