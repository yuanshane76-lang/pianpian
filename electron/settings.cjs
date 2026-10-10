const { randomUUID } = require("node:crypto");

const DEFAULT = {
  version: 1,
  revision: "local-v1",
  aiProvider: "local",
  aliyun: { apiKey: "", model: "qwen-plus", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  deepseek: { apiKey: "", model: "deepseek-flash", baseUrl: "https://api.deepseek.com" },
  mineru: { apiKey: "", endpoint: "https://mineru.net" },
};

function normalize(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    version: 1,
    revision: typeof source.revision === "string" ? source.revision : DEFAULT.revision,
    aiProvider: ["local", "aliyun", "deepseek"].includes(source.aiProvider) ? source.aiProvider : "local",
    aliyun: { ...DEFAULT.aliyun, ...source.aliyun },
    deepseek: { ...DEFAULT.deepseek, ...source.deepseek },
    mineru: { ...DEFAULT.mineru, ...source.mineru },
  };
}

function validateModel(model) {
  if (typeof model !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(model)) {
    throw new Error("模型名称只能包含字母、数字、点、横线和下划线");
  }
  return model;
}

function summary(value) {
  const settings = normalize(value);
  return {
    version: 1,
    revision: settings.revision,
    aiProvider: settings.aiProvider,
    aliyun: { configured: Boolean(settings.aliyun.apiKey), model: settings.aliyun.model, baseUrl: DEFAULT.aliyun.baseUrl },
    deepseek: { configured: Boolean(settings.deepseek.apiKey), model: settings.deepseek.model, baseUrl: DEFAULT.deepseek.baseUrl },
    mineru: { configured: Boolean(settings.mineru.apiKey), endpoint: DEFAULT.mineru.endpoint },
  };
}

function update(current, input) {
  if (!input || !["local", "aliyun", "deepseek"].includes(input.aiProvider)) {
    throw new Error("请选择有效的模型服务");
  }
  const settings = normalize(current);
  settings.revision = randomUUID();
  settings.aiProvider = input.aiProvider;
  for (const name of ["aliyun", "deepseek", "mineru"]) {
    const edit = input[name];
    if (!edit || typeof edit !== "object") continue;
    if (edit.clearApiKey === true) settings[name].apiKey = "";
    else if (typeof edit.apiKey === "string" && edit.apiKey.trim()) {
      if (edit.apiKey.length > 4096) throw new Error("密钥长度异常");
      settings[name].apiKey = edit.apiKey.trim();
    }
    if (name !== "mineru" && typeof edit.model === "string") {
      const model = edit.model.trim();
      settings[name].model = validateModel(model);
    }
    if (name === "mineru") settings[name].endpoint = DEFAULT.mineru.endpoint;
    else settings[name].baseUrl = DEFAULT[name].baseUrl;
  }
  return settings;
}

function resolveTestService(value, provider, input = {}) {
  if (!["aliyun", "deepseek", "mineru"].includes(provider)) {
    throw new Error("请选择模型服务或 MinerU");
  }
  const settings = normalize(value);
  const service = settings[provider];
  const draft = input && typeof input === "object" ? input : {};
  const apiKey = draft.clearApiKey === true
    ? ""
    : typeof draft.apiKey === "string" && draft.apiKey.trim()
      ? draft.apiKey.trim()
      : service.apiKey;
  if (!apiKey) throw new Error(provider === "mineru" ? "请先输入或保存 MinerU Token" : "请先输入或保存对应服务的密钥");
  if (apiKey.length > 4096) throw new Error("密钥长度异常");
  if (provider === "mineru") return { apiKey };
  const model = typeof draft.model === "string" && draft.model.trim()
    ? validateModel(draft.model.trim())
    : service.model;
  return { apiKey, model };
}

module.exports = { DEFAULT, normalize, summary, update, resolveTestService };
