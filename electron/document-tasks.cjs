const defaultMineru = require("./mineru.cjs");

const ACTIVE_STATES = new Set(["pending", "running", "converting", "downloading"]);
const UPLOAD_DETECTION_GRACE_MS = 120000;

function safeError(cause) {
  const message = String(cause?.message || "");
  if (/authentication|API key/i.test(message)) return new Error("MinerU 密钥无效或已过期，请检查服务配置");
  if (/quota|queue|rate limit/i.test(message)) return new Error("MinerU 额度不足或请求过于频繁，请稍后重试");
  if (/timed out/i.test(message)) return new Error("MinerU 请求超时，请稍后重试解析");
  if (/ZIP|archive|content list/i.test(message)) return new Error("MinerU 结果文件无法解析，可重试增强解析");
  if (/network|fetch|request/i.test(message)) return new Error("MinerU 网络请求失败，请稍后重试");
  return new Error("MinerU 解析请求失败，请检查网络或稍后重试");
}

function progressMessage(state, progress) {
  if (state === "pending") return "PDF 已上传，等待 MinerU 开始解析…";
  if (state === "running") {
    return progress > 0
      ? `MinerU 正在解析，已处理 ${Math.round(progress * 100)}% 页面…`
      : "MinerU 正在解析正文、图表和公式…";
  }
  if (state === "converting") return "MinerU 正在生成结构化阅读内容…";
  if (state === "downloading") return "正在下载 MinerU 结构化结果…";
  if (state === "failed") return "MinerU 解析失败，请重试";
  if (state === "waiting-file") return "MinerU 尚未接收到文件，请重试以重新上传";
  return "";
}

function needsLayoutRecovery(result) {
  return Boolean(result?.blocks?.length && result.layoutVersion !== 2);
}

function preserveBlockIds(previous, result) {
  const keyOf = (block) => JSON.stringify([block.pageNumber, block.kind, String(block.text || "").replace(/\s+/g, " ").trim()]);
  const ids = new Map();
  for (const block of previous?.blocks || []) {
    const key = keyOf(block);
    if (!ids.has(key)) ids.set(key, []);
    ids.get(key).push(block.id);
  }
  return {
    ...result,
    blocks: result.blocks.map((block) => {
      const id = ids.get(keyOf(block))?.shift();
      return id ? { ...block, id } : block;
    }),
  };
}

/**
 * Owns the durable lifecycle around one MinerU document task.
 * Network and credential access stay injected in the Electron main process.
 */
function createDocumentTasks({ documents, readSettings, mineru = defaultMineru }) {
  if (!documents || typeof documents.loadTask !== "function") {
    throw new Error("Document task store is required.");
  }
  const starts = new Map();
  const statuses = new Map();
  const operations = new Map();

  // All mutations for one document share one queue. A read/check/write alone
  // cannot stop a slower old write from replacing a newly uploaded batch.
  function exclusive(id, action) {
    const previous = operations.get(id) || Promise.resolve();
    const operation = previous.catch(() => {}).then(action);
    operations.set(id, operation);
    const clear = () => { if (operations.get(id) === operation) operations.delete(id); };
    operation.then(clear, clear);
    return operation;
  }

  async function apiKey() {
    const settings = readSettings();
    const key = settings?.mineru?.apiKey;
    if (!key) throw new Error("请先配置 MinerU Token");
    return key;
  }

  async function publishedResult(id, task) {
    if (!task?.batchId || task.resultBatchId !== task.batchId) return null;
    return documents.loadParse(id);
  }

  async function publishDownload(id, task, zipUrl) {
    const previous = await publishedResult(id, task);
    await documents.saveTask(id, {
      batchId: task.batchId,
      state: "downloading",
      progress: 1,
      zipUrl,
      ...(task.resultBatchId ? { resultBatchId: task.resultBatchId } : {}),
    });
    const archive = await mineru.downloadResultZip({ zipUrl });
    const extracted = mineru.extractResultZip(archive);
    for (const asset of extracted.assets) {
      await documents.saveAsset(id, asset.path, asset.data);
    }
    const result = preserveBlockIds(previous, extracted.result);
    await documents.saveParse(id, result);
    await documents.saveTask(id, {
      batchId: task.batchId,
      state: "done",
      progress: 1,
      resultBatchId: task.batchId,
    });
    return result;
  }

  async function start(id) {
    if (starts.has(id)) return starts.get(id);
    const operation = exclusive(id, async () => {
      const previous = await documents.loadTask(id);
      if (previous && ACTIVE_STATES.has(previous.state)) {
        return { batchId: previous.batchId };
      }
      const currentResult = await publishedResult(id, previous);
      if (currentResult && previous.state === "done" && (needsLayoutRecovery(currentResult) || currentResult.blocks?.length && currentResult.blocks.every((block) => block.bbox))) {
        return { batchId: previous.batchId };
      }
      if (previous?.state === "done" && !previous.resultBatchId) return { batchId: previous.batchId };

      const key = await apiKey();
      const data = await documents.read(id);
      try {
        const upload = await mineru.requestUpload({
          apiKey: key,
          name: `${id.slice(0, 12)}.pdf`,
        });
        await documents.saveTask(id, {
          batchId: upload.batchId,
          state: "waiting-file",
          progress: 0,
        });
        await mineru.uploadPdf({ uploadUrl: upload.uploadUrl, data });
        await documents.saveTask(id, {
          batchId: upload.batchId,
          state: "pending",
          progress: 0,
          uploadCompletedAt: Date.now(),
        });
        return { batchId: upload.batchId };
      } catch (cause) {
        const task = await documents.loadTask(id);
        if (task?.state === "waiting-file") {
          await documents.saveTask(id, {
            batchId: task.batchId,
            state: "failed",
            progress: 0,
          });
        }
        throw safeError(cause);
      }
    });
    starts.set(id, operation);
    try {
      return await operation;
    } finally {
      starts.delete(id);
    }
  }

  async function status(id) {
    if (statuses.has(id)) return statuses.get(id);
    const operation = exclusive(id, async () => {
      const task = await documents.loadTask(id);
      if (!task?.batchId) return { state: "idle" };

      const currentResult = await publishedResult(id, task);
      if (currentResult && task.state === "done" && !needsLayoutRecovery(currentResult)) {
        return { state: "done", batchId: task.batchId, result: currentResult };
      }

      try {
        if (task.state === "downloading" && task.zipUrl) {
          const result = await publishDownload(id, task, task.zipUrl);
          return { state: "done", batchId: task.batchId, result };
        }

        const key = await apiKey();
        const remote = await mineru.getBatch({
          apiKey: key,
          batchId: task.batchId,
        });
        const latest = await documents.loadTask(id);
        if (!latest || latest.batchId !== task.batchId) {
          const result = latest?.state === "done" ? await publishedResult(id, latest) : null;
          if (result && !needsLayoutRecovery(result)) return { state: "done", batchId: latest.batchId, result };
          return { state: latest?.state || "idle", batchId: latest?.batchId, progress: latest?.progress,
            message: progressMessage(latest?.state, latest?.progress) };
        }
        if (remote.state === "done") {
          if (!remote.zipUrl) throw new Error("MinerU 返回结果地址为空");
          await documents.saveTask(id, {
            batchId: task.batchId, state: "downloading", progress: 1, zipUrl: remote.zipUrl,
            ...(task.resultBatchId ? { resultBatchId: task.resultBatchId } : {}),
          });
          // Publish the download phase before blocking on the archive and asset
          // writes. The next status call completes it from the durable ZIP URL.
          return { state: "downloading", batchId: task.batchId, progress: 1, message: progressMessage("downloading", 1) };
        }

        // PUT can finish before MinerU's task index notices the file. Keep the
        // accepted upload pending for a bounded interval, including after restart.
        const detectingUpload = remote.state === "waiting-file"
          && Number.isFinite(latest.uploadCompletedAt)
          && Date.now() - latest.uploadCompletedAt < UPLOAD_DETECTION_GRACE_MS;
        const state = detectingUpload ? "pending" : remote.state;
        await documents.saveTask(id, {
          batchId: task.batchId,
          state,
          progress: remote.progress,
          ...(latest.uploadCompletedAt ? { uploadCompletedAt: latest.uploadCompletedAt } : {}),
          ...(latest.resultBatchId ? { resultBatchId: latest.resultBatchId } : {}),
          ...(remote.error ? { error: remote.error } : {}),
        });
        const restarting = remote.state === "waiting-file" && starts.has(id);
        return {
          state: restarting ? "pending" : state,
          progress: remote.progress,
          batchId: task.batchId,
          message: restarting ? "正在继续解析任务…" : detectingUpload ? "PDF 已上传，正在等待 MinerU 确认文件…" : progressMessage(state, remote.progress),
          ...(remote.error ? { error: remote.error } : {}),
        };
      } catch (cause) {
        // A retry queued behind this operation owns the next attempt. Let the
        // renderer continue polling instead of stopping on the older GET error.
        if (starts.has(id)) return { state: "pending", batchId: task.batchId, message: "正在继续解析任务…" };
        throw safeError(cause);
      }
    });
    statuses.set(id, operation);
    try {
      return await operation;
    } finally {
      statuses.delete(id);
    }
  }

  async function snapshot(id) {
    const task = await documents.loadTask(id);
    const result = await publishedResult(id, task);
    const legacyDone = task?.state === "done" && task.batchId && !task.resultBatchId;
    const missingPublished = task?.state === "done" && task.resultBatchId === task.batchId && !result;
    return { task, result, ...(needsLayoutRecovery(result) || legacyDone || missingPublished ? { layoutRecoveryNeeded: true } : {}) };
  }

  return { start, status, snapshot };
}

module.exports = { createDocumentTasks };
