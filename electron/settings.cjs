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
      if (!/^[a-zA-Z0-9._-]{1,80}$/.test(model)) throw new Error("模型名称只能包含字母、数字、点、横线和下划线");
      settings[name].model = model;
    }
    if (name === "mineru") settings[name].endpoint = DEFAULT.mineru.endpoint;
    else settings[name].baseUrl = DEFAULT[name].baseUrl;
  }
  return settings;
}

module.exports = { DEFAULT, normalize, summary, update };
