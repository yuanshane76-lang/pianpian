/** Read only published local parse assets. No remote requests or user-supplied paths. */
function createLibraryPaperReader({ documents }) {
  return async (paper) => {
    if (!paper.originalId) return null;
    const task = await documents.loadTask(paper.originalId);
    if (task?.state !== "done" || !task.batchId || task.resultBatchId !== task.batchId) return null;
    const parsed = await documents.loadParse(paper.originalId);
    if (!parsed || parsed.layoutVersion !== 3 || !Array.isArray(parsed.blocks)) return null;
    return { ...paper, blocks: parsed.blocks.filter((block) => typeof block?.id === "string" && block.id && Number.isInteger(block.pageNumber))
      .map((block) => ({ id: block.id, pageNumber: block.pageNumber,
        text: String(block.text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() })).filter((block) => block.text) };
  };
}
module.exports = { createLibraryPaperReader };
