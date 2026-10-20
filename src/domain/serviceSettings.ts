export type AiProvider = "aliyun" | "deepseek";

export interface StoredServiceSettings {
  version: 1;
  revision: string;
  aiProvider: AiProvider;
  aliyun: {
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  deepseek: {
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  mineru: {
    apiKey: string;
    endpoint: string;
  };
  semanticScholar: {
    apiKey: string;
  };
}

export interface ServiceSettingsInput {
  aiProvider: AiProvider;
  aliyun: {
    apiKey?: string;
    model: string;
    baseUrl: string;
    clearApiKey?: boolean;
  };
  deepseek: {
    apiKey?: string;
    model: string;
    baseUrl: string;
    clearApiKey?: boolean;
  };
  mineru: {
    apiKey?: string;
    endpoint?: string;
    clearApiKey?: boolean;
  };
  semanticScholar: {
    apiKey?: string;
    clearApiKey?: boolean;
  };
}

export interface PublicServiceSettings {
  version: 1;
  revision: string;
  aiProvider: AiProvider;
  aliyun: {
    configured: boolean;
    model: string;
    baseUrl: string;
  };
  deepseek: {
    configured: boolean;
    model: string;
    baseUrl: string;
  };
  mineru: {
    configured: boolean;
    endpoint: string;
  };
  semanticScholar: {
    configured: boolean;
    endpoint: string;
  };
}

export function getMissingServiceCredentials(settings: PublicServiceSettings): Array<"model" | "parser"> {
  const missing: Array<"model" | "parser"> = [];
  if (!settings[settings.aiProvider].configured) missing.push("model");
  if (!settings.mineru.configured) missing.push("parser");
  return missing;
}

export const DEFAULT_SERVICE_SETTINGS: StoredServiceSettings = {
  version: 1,
  revision: "service-v1",
  aiProvider: "deepseek",
  aliyun: {
    apiKey: "",
    model: "qwen-plus",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  deepseek: {
    apiKey: "",
    model: "deepseek-flash",
    baseUrl: "https://api.deepseek.com",
  },
  mineru: {
    apiKey: "",
    endpoint: "https://mineru.net",
  },
  semanticScholar: {
    apiKey: "",
  },
};

export const SEMANTIC_SCHOLAR_ENDPOINT = "https://api.semanticscholar.org";

function keepOrReplace(previous: string, next: string | undefined, clear: boolean | undefined): string {
  if (clear) return "";
  return next?.trim() ? next.trim() : previous;
}

export function mergeServiceSettings(
  previous: StoredServiceSettings,
  input: ServiceSettingsInput,
): StoredServiceSettings {
  return {
    version: 1,
    revision: previous.revision,
    aiProvider: input.aiProvider,
    aliyun: {
      apiKey: keepOrReplace(previous.aliyun.apiKey, input.aliyun.apiKey, input.aliyun.clearApiKey),
      model: input.aliyun.model.trim() || previous.aliyun.model,
      baseUrl: input.aliyun.baseUrl.trim() || previous.aliyun.baseUrl,
    },
    deepseek: {
      apiKey: keepOrReplace(previous.deepseek.apiKey, input.deepseek.apiKey, input.deepseek.clearApiKey),
      model: input.deepseek.model.trim() || previous.deepseek.model,
      baseUrl: input.deepseek.baseUrl.trim() || previous.deepseek.baseUrl,
    },
    mineru: {
      apiKey: keepOrReplace(previous.mineru.apiKey, input.mineru.apiKey, input.mineru.clearApiKey),
      endpoint: input.mineru.endpoint?.trim() || previous.mineru.endpoint,
    },
    semanticScholar: {
      apiKey: keepOrReplace(previous.semanticScholar.apiKey, input.semanticScholar.apiKey, input.semanticScholar.clearApiKey),
    },
  };
}

export function toPublicServiceSettings(settings: StoredServiceSettings): PublicServiceSettings {
  return {
    version: 1,
    revision: settings.revision,
    aiProvider: settings.aiProvider,
    aliyun: {
      configured: Boolean(settings.aliyun.apiKey),
      model: settings.aliyun.model,
      baseUrl: settings.aliyun.baseUrl,
    },
    deepseek: {
      configured: Boolean(settings.deepseek.apiKey),
      model: settings.deepseek.model,
      baseUrl: settings.deepseek.baseUrl,
    },
    mineru: {
      configured: Boolean(settings.mineru.apiKey),
      endpoint: settings.mineru.endpoint,
    },
    semanticScholar: {
      configured: Boolean(settings.semanticScholar.apiKey),
      endpoint: SEMANTIC_SCHOLAR_ENDPOINT,
    },
  };
}

export function normalizeStoredServiceSettings(value: unknown): StoredServiceSettings {
  const source = value && typeof value === "object" ? value as Partial<StoredServiceSettings> : {};
  const aliyun: Partial<StoredServiceSettings["aliyun"]> = source.aliyun ?? {};
  const deepseek: Partial<StoredServiceSettings["deepseek"]> = source.deepseek ?? {};
  const mineru: Partial<StoredServiceSettings["mineru"]> = source.mineru ?? {};
  const semanticScholar: Partial<StoredServiceSettings["semanticScholar"]> = source.semanticScholar ?? {};
  const aiProvider = source.aiProvider === "aliyun" || source.aiProvider === "deepseek"
    ? source.aiProvider
    : DEFAULT_SERVICE_SETTINGS.aiProvider;

  return {
    version: 1,
    revision: typeof source.revision === "string" ? source.revision : DEFAULT_SERVICE_SETTINGS.revision,
    aiProvider,
    aliyun: {
      apiKey: typeof aliyun.apiKey === "string" ? aliyun.apiKey : DEFAULT_SERVICE_SETTINGS.aliyun.apiKey,
      model: typeof aliyun.model === "string" && aliyun.model ? aliyun.model : DEFAULT_SERVICE_SETTINGS.aliyun.model,
      baseUrl: typeof aliyun.baseUrl === "string" && aliyun.baseUrl ? aliyun.baseUrl : DEFAULT_SERVICE_SETTINGS.aliyun.baseUrl,
    },
    deepseek: {
      apiKey: typeof deepseek.apiKey === "string" ? deepseek.apiKey : DEFAULT_SERVICE_SETTINGS.deepseek.apiKey,
      model: typeof deepseek.model === "string" && deepseek.model ? deepseek.model : DEFAULT_SERVICE_SETTINGS.deepseek.model,
      baseUrl: typeof deepseek.baseUrl === "string" && deepseek.baseUrl ? deepseek.baseUrl : DEFAULT_SERVICE_SETTINGS.deepseek.baseUrl,
    },
    mineru: {
      apiKey: typeof mineru.apiKey === "string" ? mineru.apiKey : DEFAULT_SERVICE_SETTINGS.mineru.apiKey,
      endpoint: typeof mineru.endpoint === "string" && mineru.endpoint ? mineru.endpoint : DEFAULT_SERVICE_SETTINGS.mineru.endpoint,
    },
    semanticScholar: {
      apiKey: typeof semanticScholar.apiKey === "string" ? semanticScholar.apiKey : DEFAULT_SERVICE_SETTINGS.semanticScholar.apiKey,
    },
  };
}
