const { randomUUID } = require("node:crypto");
const { downloadArxivPdf } = require("./arxiv-pdf-download.cjs");

function createLiteratureImports({ documents, download, leaseTimeoutMs = 5 * 60_000 }) {
  let tail = Promise.resolve();
  const pending = new Map();
  const downloadPdf = download || ((arxivId) => downloadArxivPdf({ arxivId, documents }));

  async function acquire() {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    return release;
  }

  async function run(action) {
    const release = await acquire();
    try {
      return await action();
    } finally {
      release();
    }
  }

  function finish(input) {
    if (typeof input?.importId !== "string" || typeof input?.retained !== "boolean") {
      throw new Error("论文导入回执无效");
    }
    const operation = pending.get(input.importId);
    if (!operation) return Promise.resolve(false);
    if (!operation.completion) {
      clearTimeout(operation.timer);
      operation.completion = (async () => {
        try {
          if (!input.retained && !operation.saved.duplicate) await documents.remove(operation.saved.id);
          return true;
        } finally {
          pending.delete(input.importId);
          operation.release();
        }
      })();
    }
    return operation.completion;
  }

  async function start(arxivId) {
    const release = await acquire();
    try {
      const saved = await downloadPdf(arxivId);
      const importId = randomUUID();
      const operation = { saved, release, timer: null, completion: null };
      pending.set(importId, operation);
      // If a renderer disappears, preserve the original and let later imports proceed.
      operation.timer = setTimeout(() => { void finish({ importId, retained: true }); }, leaseTimeoutMs);
      operation.timer.unref?.();
      return { ...saved, importId };
    } catch (error) {
      release();
      throw error;
    }
  }

  return { start, finish, run };
}

module.exports = { createLiteratureImports };
