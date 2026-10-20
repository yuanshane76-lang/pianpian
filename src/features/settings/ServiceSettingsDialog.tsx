import { CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, LoaderCircle, Settings2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  DEFAULT_SERVICE_SETTINGS,
  getMissingServiceCredentials,
  toPublicServiceSettings,
  type AiProvider,
  type PublicServiceSettings,
  type ServiceSettingsInput,
} from "../../domain/serviceSettings";
import { getDesktopBridge } from "../../platform/electron";
import { Pianpian } from "../../brand/Pianpian";

interface Props {
  required?: boolean;
  initialSettings?: PublicServiceSettings;
  readFailed?: boolean;
  onClose: () => void;
  onSaved: (settings: PublicServiceSettings) => void;
}

const defaultView = toPublicServiceSettings(DEFAULT_SERVICE_SETTINGS);

export function ServiceSettingsDialog({ onClose, onSaved, required = false, initialSettings, readFailed = false }: Props) {
  const [current, setCurrent] = useState<PublicServiceSettings>(initialSettings ?? defaultView);
  const [loaded, setLoaded] = useState(Boolean(initialSettings));
  const [readError, setReadError] = useState(readFailed);
  const [provider, setProvider] = useState<AiProvider>(initialSettings?.aiProvider ?? "deepseek");
  const [serviceArea, setServiceArea] = useState<"model" | "parser" | "search">(
    required && initialSettings && getMissingServiceCredentials(initialSettings)[0] === "parser" ? "parser" : "model",
  );
  const [model, setModel] = useState({ aliyun: initialSettings?.aliyun.model ?? "qwen-plus", deepseek: initialSettings?.deepseek.model ?? "deepseek-flash" });
  const [keys, setKeys] = useState({ aliyun: "", deepseek: "", mineru: "", semanticScholar: "" });
  const [clearKeys, setClearKeys] = useState({ aliyun: false, deepseek: false, mineru: false, semanticScholar: false });
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const desktop = getDesktopBridge();
  const dialogRef = useRef<HTMLElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const missing = getMissingServiceCredentials({ ...current, aiProvider: provider });
  const serviceTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const providerRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveSelection(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    kind: "area" | "provider",
  ) {
    const refs = kind === "area" ? serviceTabRefs.current : providerRefs.current;
    const count = kind === "area" ? 3 : refs.length;
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % count;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + count - 1) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else return;
    event.preventDefault();
    refs[next]?.focus();
    if (kind === "area") setServiceArea((["model", "parser", "search"] as const)[next] ?? "model");
    else setProvider(next === 0 ? "aliyun" : "deepseek");
  }

  useEffect(() => {
    if (!desktop || initialSettings || readFailed) return;
    let active = true;
    desktop.invoke<PublicServiceSettings>("zhiyan:settings:get").then((settings) => {
      if (!active) return;
      setCurrent(settings);
      setLoaded(true);
      setProvider(settings.aiProvider);
      setModel({ aliyun: settings.aliyun.model, deepseek: settings.deepseek.model });
      if (required) setServiceArea(getMissingServiceCredentials(settings)[0] === "parser" ? "parser" : "model");
    }).catch((cause) => {
      if (active) { setReadError(true); setError(cause instanceof Error ? cause.message : "无法读取服务配置"); }
    });
    return () => { active = false; };
  }, [desktop]);

  useEffect(() => {
    if (!required) return;
    const element = dialogRef.current;
    const overlay = element?.parentElement;
    if (!element || !overlay) return;
    const siblings = [...(overlay.parentElement?.children ?? [])].filter((sibling) => sibling !== overlay);
    const prior = siblings.map((sibling) => [sibling, sibling.hasAttribute("inert")] as const);
    for (const sibling of siblings) sibling.setAttribute("inert", "");
    function constrainFocus(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); return; }
      if (event.key !== "Tab") return;
      const controls = [...element!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')];
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); element!.focus(); return; }
      if (!element!.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); first.focus();
      } else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    }
    document.addEventListener("keydown", constrainFocus, true);
    return () => {
      document.removeEventListener("keydown", constrainFocus, true);
      for (const [sibling, wasInert] of prior) if (!wasInert) sibling.removeAttribute("inert");
    };
  }, [required]);

  useEffect(() => {
    if (!required) return;
    const target = loaded && !readError
      ? dialogRef.current?.querySelector<HTMLInputElement>(serviceArea === "parser" ? "#mineru-key" : `#${provider}-key`)
      : dialogRef.current?.querySelector<HTMLElement>("button");
    (target ?? dialogRef.current)?.focus();
  }, [required, loaded, readError, focusRequest]);

  async function retryRead() {
    if (!desktop) return;
    setBusy(true); setError("");
    try {
      const settings = await desktop.invoke<PublicServiceSettings>("zhiyan:settings:get");
      setCurrent(settings); setProvider(settings.aiProvider);
      setModel({ aliyun: settings.aliyun.model, deepseek: settings.deepseek.model });
      setReadError(false); setLoaded(true);
      setServiceArea(getMissingServiceCredentials(settings)[0] === "parser" ? "parser" : "model");
      setFocusRequest((value) => value + 1);
      onSaved(settings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取服务配置，请重试。");
    } finally { setBusy(false); }
  }

  async function save() {
    if (!desktop || !loaded || readError) return;
    setBusy(true);
    setFeedback("");
    setError("");
    const input: ServiceSettingsInput = {
      aiProvider: provider,
      aliyun: { apiKey: keys.aliyun, model: model.aliyun, baseUrl: current.aliyun.baseUrl, clearApiKey: clearKeys.aliyun },
      deepseek: { apiKey: keys.deepseek, model: model.deepseek, baseUrl: current.deepseek.baseUrl, clearApiKey: clearKeys.deepseek },
      mineru: { apiKey: keys.mineru, endpoint: current.mineru.endpoint, clearApiKey: clearKeys.mineru },
      semanticScholar: { apiKey: keys.semanticScholar, clearApiKey: clearKeys.semanticScholar },
    };
    try {
      const settings = await desktop.invoke<PublicServiceSettings>("zhiyan:settings:save", input);
      setCurrent(settings);
      setKeys({ aliyun: "", deepseek: "", mineru: "", semanticScholar: "" });
      setClearKeys({ aliyun: false, deepseek: false, mineru: false, semanticScholar: false });
      const remaining = getMissingServiceCredentials(settings);
      if (required && remaining.length) {
        setServiceArea(remaining[0]);
        setFocusRequest((value) => value + 1);
        setFeedback(remaining.length === 2 ? "请填写模型 API Key 和 MinerU Token 后保存。"
          : remaining[0] === "parser" ? "模型密钥已保存，请继续填写 MinerU Token。" : "MinerU Token 已保存，请继续填写模型 API Key。");
      } else setFeedback("配置已加密保存在本机。");
      onSaved(settings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(name: "aliyun" | "deepseek" | "mineru") {
    if (!desktop) return;
    setBusy(true);
    setFeedback("");
    setError("");
    try {
      const result = await desktop.invoke<{ message: string }>("zhiyan:settings:test", {
        provider: name,
        ...(keys[name].trim() ? { apiKey: keys[name] } : {}),
        ...(name === "aliyun" || name === "deepseek" ? { model: model[name] } : {}),
        ...(clearKeys[name] ? { clearApiKey: true } : {}),
      });
      setFeedback(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接失败");
    } finally {
      setBusy(false);
    }
  }

  function keyField(name: "aliyun" | "deepseek" | "mineru" | "semanticScholar", label: string) {
    const hasDraftKey = Boolean(keys[name].trim());
    const keyStatus = clearKeys[name]
      ? "待删除"
      : hasDraftKey
        ? "待保存"
        : current[name].configured
          ? "已保存"
          : "未配置";
    return (
      <div className="settings-field" key={name}>
        <label htmlFor={`${name}-key`}>{label} <span>{keyStatus}</span></label>
        <div className="settings-key-row">
          <input
            id={`${name}-key`}
            autoComplete="off"
            placeholder={current[name].configured ? "留空表示保留已保存密钥" : "在此粘贴密钥"}
            type={revealed[name] ? "text" : "password"}
            value={keys[name]}
            onChange={(event) => {
              setKeys((value) => ({ ...value, [name]: event.target.value }));
              setClearKeys((value) => ({ ...value, [name]: false }));
            }}
          />
          <button className="icon-button" type="button" title={revealed[name] ? "隐藏密钥" : "显示输入"} aria-label={revealed[name] ? "隐藏密钥" : "显示输入"} onClick={() => setRevealed((value) => ({ ...value, [name]: !value[name] }))}>
            {revealed[name] ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button className="icon-button" type="button" title="删除已保存密钥" aria-label={`删除${label}`} onClick={() => { setKeys((value) => ({ ...value, [name]: "" })); setClearKeys((value) => ({ ...value, [name]: true })); }}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-overlay" onMouseDown={(event) => { if (!required && event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} className="settings-dialog" role="dialog" aria-modal="true" aria-label="服务配置" aria-describedby={required ? "service-setup-description" : undefined}>
        <header className="settings-header">
          <div><Settings2 size={19} /><h2>服务配置</h2></div>
          {required ? <span className="settings-required-label">使用前需配置</span> : <button className="icon-button" type="button" aria-label="关闭配置" title="关闭配置" onClick={onClose}><X size={18} /></button>}
        </header>
        <div className="settings-body">
          {!desktop ? <p className="settings-notice">密钥只支持在桌面程序中加密保存。请打开 ZIP 内的 Pianpian.exe 进行配置。</p> : null}
          {required ? <section className="settings-setup" aria-label="服务配置引导">
            <div className="settings-setup-heading"><Pianpian /><strong>完成配置后开始使用</strong>
              {loaded && !readError ? <span>已完成 {2 - missing.length} / 2</span> : null}</div>
            <p id="service-setup-description">你好，我是篇篇。先连接一个模型服务和 MinerU，我们就能一起读论文了。需要填写 API Key 和 MinerU Token，支持分步保存，补齐后自动进入文献库。</p>
            {loaded && !readError ? <ol className="settings-setup-steps">
              <li data-complete={!missing.includes("model")}><CheckCircle2 size={15} aria-hidden="true" />模型服务 <span>{missing.includes("model") ? "待填写" : "已保存"}</span></li>
              <li data-complete={!missing.includes("parser")}><CheckCircle2 size={15} aria-hidden="true" />MinerU 解析 <span>{missing.includes("parser") ? "待填写" : "已保存"}</span></li>
            </ol> : null}
          </section> : null}
          {readError ? <div className="settings-notice" role="alert"><p>无法读取已保存的服务配置。请先重新读取，不会覆盖原有密钥。</p><button type="button" className="secondary-button compact" disabled={busy} onClick={retryRead}>重新读取配置</button></div> : null}
          {!loaded && !readError && desktop ? <p role="status">正在读取服务配置…</p> : null}
          {(loaded || !desktop) && !readError ? <>
          <div className="settings-service-tabs" role="tablist" aria-label="选择服务配置">
            <button
              type="button"
              role="tab"
              aria-selected={serviceArea === "model"}
              aria-controls="model-service-panel"
              ref={(element) => { serviceTabRefs.current[0] = element; }}
              className={serviceArea === "model" ? "is-selected" : ""}
              onClick={() => setServiceArea("model")}
              onKeyDown={(event) => moveSelection(event, 0, "area")}
            >
              <strong>模型服务</strong><span>让篇篇帮你翻译、理解和对话</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={serviceArea === "parser"}
              aria-controls="paper-parser-panel"
              ref={(element) => { serviceTabRefs.current[1] = element; }}
              className={serviceArea === "parser" ? "is-selected" : ""}
              onClick={() => setServiceArea("parser")}
              onKeyDown={(event) => moveSelection(event, 1, "area")}
            >
              <strong>论文解析</strong><span>MinerU 负责段落、图表和坐标</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={serviceArea === "search"}
              aria-controls="literature-search-panel"
              ref={(element) => { serviceTabRefs.current[2] = element; }}
              className={serviceArea === "search" ? "is-selected" : ""}
              onClick={() => setServiceArea("search")}
              onKeyDown={(event) => moveSelection(event, 2, "area")}
            >
              <strong>文献检索</strong><span>查找相似论文的公开元数据</span>
            </button>
          </div>
          {serviceArea === "model" ? (
            <div id="model-service-panel" className="settings-service-panel" role="tabpanel" aria-label="模型服务配置">
              <div className="settings-panel-heading">
                <div><h3>选择模型服务商</h3><span>两者二选一，当前只使用选中的服务商</span></div>
                <span className="settings-panel-status">{current[provider].configured ? "已配置" : "待配置"}</span>
              </div>
              <div className="settings-provider-options" role="radiogroup" aria-label="模型服务商">
                {([["aliyun", "阿里云百炼", "通义千问兼容接口"], ["deepseek", "DeepSeek 官方", "DeepSeek 官方接口"]] as const).map(([id, label, description], index) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={provider === id}
                    ref={(element) => { providerRefs.current[index] = element; }}
                    className={`settings-provider-option ${provider === id ? "is-selected" : ""}`}
                    onClick={() => setProvider(id)}
                    onKeyDown={(event) => moveSelection(event, index, "provider")}
                  >
                    <span className="settings-provider-option-top"><strong>{label}</strong><span>{current[id].configured ? "已配置" : "未配置"}</span></span>
                    <small>{description}</small>
                  </button>
                ))}
              </div>
              <p className="settings-description">真实分析会将所需论文正文发送给选中的模型服务商，可能产生调用费用。</p>
              {provider === "aliyun" ? (
                <>
                  {keyField("aliyun", "百炼 API Key")}
                  <label className="settings-field" htmlFor="aliyun-model">模型名称<input id="aliyun-model" value={model.aliyun} onChange={(event) => setModel((value) => ({ ...value, aliyun: event.target.value }))} /></label>
                  <p className="settings-endpoint">官方接口：{current.aliyun.baseUrl}</p>
                  <div className="settings-service-actions">
                    <a href="https://bailian.console.aliyun.com/" target="_blank" rel="noreferrer">打开百炼控制台 <ExternalLink size={13} /></a>
                    <button type="button" className="secondary-button compact" disabled={busy || (!current.aliyun.configured && !keys.aliyun.trim()) || clearKeys.aliyun} onClick={() => testConnection("aliyun")}>测试所选模型（可能计费）</button>
                  </div>
                </>
              ) : null}
              {provider === "deepseek" ? (
                <>
                  {keyField("deepseek", "DeepSeek API Key")}
                  <label className="settings-field" htmlFor="deepseek-model">模型名称<input id="deepseek-model" value={model.deepseek} onChange={(event) => setModel((value) => ({ ...value, deepseek: event.target.value }))} /></label>
                  <p className="settings-endpoint">官方接口：{current.deepseek.baseUrl}</p>
                  <div className="settings-service-actions">
                    <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer">打开 DeepSeek 开放平台 <ExternalLink size={13} /></a>
                    <button type="button" className="secondary-button compact" disabled={busy || (!current.deepseek.configured && !keys.deepseek.trim()) || clearKeys.deepseek} onClick={() => testConnection("deepseek")}>测试所选模型（可能计费）</button>
                  </div>
                </>
              ) : null}
            </div>
          ) : serviceArea === "parser" ? (
            <div id="paper-parser-panel" className="settings-service-panel" role="tabpanel" aria-label="论文解析服务配置">
              <div className="settings-panel-heading">
                <div><h3>MinerU 论文解析</h3><span>独立于模型服务，用于准备可定位的论文阅读面</span></div>
                <span className="settings-panel-status">{current.mineru.configured ? "已配置" : "待配置"}</span>
              </div>
              <p className="settings-description">MinerU 用于整理论文段落、图表、表格和公式。配置后导入 PDF 会自动上传解析；原件保存在本机，解析和坐标准备完成后才能打开阅读。</p>
              {keyField("mineru", "MinerU API Token")}
              <div className="mineru-guide">
                <strong>如何获取 MinerU Token</strong>
                <ol>
                  <li>打开 MinerU 官网，注册或登录账号并完成平台要求的验证。</li>
                  <li>进入 API 管理页面，查看 API 服务是否已开通；若需要申请，按页面要求提交用途并等待审核。</li>
                  <li>创建或复制 API Token，留意额度、有效期和计费规则。</li>
                  <li>回到这里粘贴 Token 并点击“保存配置”。不要把 Token 发给他人或写进论文文件。</li>
                </ol>
                <a href="https://mineru.net/apiManage/token" target="_blank" rel="noreferrer">打开 Token 管理页 <ExternalLink size={13} /></a>
                <a href="https://mineru.net/apiManage/docs" target="_blank" rel="noreferrer">查看官方 API 文档 <ExternalLink size={13} /></a>
              </div>
              <button type="button" className="secondary-button compact" disabled={busy || (!current.mineru.configured && !keys.mineru.trim()) || clearKeys.mineru} onClick={() => testConnection("mineru")}>检查 MinerU 配置</button>
            </div>
          ) : (
            <div id="literature-search-panel" className="settings-service-panel" role="tabpanel" aria-label="文献检索服务配置">
              <div className="settings-panel-heading">
                <div><h3>Semantic Scholar 文献检索</h3><span>为「相似论文」提供公开元数据候选</span></div>
                <span className="settings-panel-status">{current.semanticScholar.configured ? "已配置" : "公共池"}</span>
              </div>
              <p className="settings-description">无需付费，留空即可使用公开共享额度池，高峰期可能被限流。填写免费申请的 API Key 可使用专属免费额度。该服务只读取公开论文元数据，不下载全文。</p>
              {keyField("semanticScholar", "Semantic Scholar API Key")}
              <div className="mineru-guide">
                <strong>如何获取免费 API Key</strong>
                <ol>
                  <li>打开 Semantic Scholar 官网并注册或登录账号。</li>
                  <li>在 API 页面提交用途说明，申请免费的 API Key。</li>
                  <li>回到这里粘贴并点击“保存配置”；留空表示继续使用公共池。</li>
                </ol>
                <a href="https://www.semanticscholar.org/product/api" target="_blank" rel="noreferrer">申请免费 API Key <ExternalLink size={13} /></a>
              </div>
            </div>
          )}
          </> : null}
        </div>
        <footer className="settings-footer">
          <span><KeyRound size={14} /> 已保存密钥不会回显</span>
          {error ? <p role="alert" className="settings-error">{error}</p> : null}
          {feedback ? <p role="status" className="settings-success">{feedback}</p> : null}
          <button className="primary-button" type="button" disabled={busy || !desktop || !loaded || readError} onClick={save}>
            {busy ? <LoaderCircle size={15} className="spin" /> : null}保存配置
          </button>
        </footer>
      </section>
    </div>
  );
}
