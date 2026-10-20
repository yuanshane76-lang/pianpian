export interface ResearchCitationInput {
  paperTitle: string;
  pageNumber?: number;
  blockId: string;
  text: string;
}

const MAX_CITATION_TEXT = 3200;

export function formatResearchCitation(input: ResearchCitationInput): string {
  const title = input.paperTitle.trim() || "当前论文";
  const page = Number.isInteger(input.pageNumber) ? `第 ${input.pageNumber} 页` : "页码未知";
  const text = input.text.trim().slice(0, MAX_CITATION_TEXT);
  const quoted = text.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
  return [
    "请结合下面这段原文回答：",
    "",
    `《${title}》${page} · 段落 ${input.blockId}`,
    quoted,
    "",
  ].join("\n");
}
