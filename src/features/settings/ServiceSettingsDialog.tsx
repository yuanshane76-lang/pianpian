import { ExternalLink, Eye, EyeOff, KeyRound, LoaderCircle, Settings2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  DEFAULT_SERVICE_SETTINGS,
  toPublicServiceSettings,
  type AiProvider,
  type PublicServiceSettings,
  type ServiceSettingsInput,
} from "../../domain/serviceSettings";
import { getDesktopBridge } from "../../platform/electron";

interface Props {
  onClose: () => void;
  onSaved: (settings: PublicServiceSettings) => void;
}

const defaultView = toPublicServiceSettings(DEFAULT_SERVICE_SETTINGS);

export function ServiceSettingsDialog({ onClose, onSaved }: Props) {
  const [current, setCurrent] = useState<PublicServiceSettings>(defaultView);
  const [provider, setProvider] = useState<AiProvider>("deepseek");
  const [serviceArea, setServiceArea] = useState<"model" | "parser">("model");
  const [model, setModel] = useState({ aliyun: "qwen-plus", deepseek: "deepseek-flash" });
  const [keys, setKeys] = useState({ aliyun: "", deepseek: "", mineru: "" });
  const [clearKeys, setClearKeys] = useState({ aliyun: false, deepseek: false, mineru: false });
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const desktop = getDesktopBridge();
  const serviceTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const providerRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveSelection(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    kind: "area" | "provider",
  ) {
    const refs = kind === "area" ? serviceTabRefs.current : providerRefs.current;
    const count = refs.length;
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % count;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + count - 1) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else return;
    event.preventDefault();
    refs[next]?.focus();
    if (kind === "area") setServiceArea(next === 0 ? "model" : "parser");
    else setProvider(next === 0 ? "aliyun" : "deepseek");
  }

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    desktop.invoke<PublicServiceSettings>("zhiyan:settings:get").then((settings) => {
      if (!active) return;
      setCurrent(settings);
      setProvider(settings.aiProvider);
      setModel({ aliyun: settings.aliyun.model, deepseek: settings.deepseek.model });
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "无法读取服务配置");
    });
    return () => { active = false; };
  }, [desktop]);

  async function save() {
    if (!desktop) return;
    setBusy(true);
    setFeedback("");
    setError("");
    const input: ServiceSettingsInput = {
      aiProvider: provider,
      aliyun: { apiKey: keys.aliyun, model: model.aliyun, baseUrl: current.aliyun.baseUrl, clearApiKey: clearKeys.aliyun },
      deepseek: { apiKey: keys.deepseek, model: model.deepseek, baseUrl: current.deepseek.baseUrl, clearApiKey: clearKeys.deepseek },
      mineru: { apiKey: keys.mineru, endpoint: current.mineru.endpoint, clearApiKey: clearKeys.mineru },
    };
    try {
      const settings = await desktop.invoke<PublicServiceSettings>("zhiyan:settings:save", input);
      setCurrent(settings);
      setKeys({ aliyun: "", deepseek: "", mineru: "" });
      setClearKeys({ aliyun: false, deepseek: false, mineru: false });
      setFeedback("配置已加密保存在本机。");
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

  function keyField(name: "aliyun" | "deepseek" | "mineru", label: string) {
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
    <div className="settings-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="服务配置">
        <header className="settings-header">
          <div><Settings2 size={19} /><h2>服务配置</h2></div>
          <button className="icon-button" type="button" aria-label="关闭配置" title="关闭配置" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="settings-body">
          {!desktop ? <p className="settings-notice">密钥只支持在桌面程序中加密保存。请打开 ZIP 内的 Zhiyan.exe 进行配置。</p> : null}
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
              <strong>模型服务</strong><span>用于翻译、问答和研究 Agent</span>
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
                  <a href="https://bailian.console.aliyun.com/" target="_blank" rel="noreferrer">打开百炼控制台 <ExternalLink size={13} /></a>
                  <button type="button" className="secondary-button compact" disabled={busy || (!current.aliyun.configured && !keys.aliyun.trim()) || clearKeys.aliyun} onClick={() => testConnection("aliyun")}>测试所选模型（可能计费）</button>
                </>
              ) : null}
              {provider === "deepseek" ? (
                <>
                  {keyField("deepseek", "DeepSeek API Key")}
                  <label className="settings-field" htmlFor="deepseek-model">模型名称<input id="deepseek-model" value={model.deepseek} onChange={(event) => setModel((value) => ({ ...value, deepseek: event.target.value }))} /></label>
                  <p className="settings-endpoint">官方接口：{current.deepseek.baseUrl}</p>
                  <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer">打开 DeepSeek 开放平台 <ExternalLink size={13} /></a>
                  <button type="button" className="secondary-button compact" disabled={busy || (!current.deepseek.configured && !keys.deepseek.trim()) || clearKeys.deepseek} onClick={() => testConnection("deepseek")}>测试所选模型（可能计费）</button>
                </>
              ) : null}
            </div>
          ) : (
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
          )}
        </div>
        <footer className="settings-footer">
          <span><KeyRound size={14} /> 已保存密钥不会回显</span>
          {error ? <p role="alert" className="settings-error">{error}</p> : null}
          {feedback ? <p role="status" className="settings-success">{feedback}</p> : null}
          <button className="primary-button" type="button" disabled={busy || !desktop} onClick={save}>
            {busy ? <LoaderCircle size={15} className="spin" /> : null}保存配置
          </button>
        </footer>
      </section>
    </div>
  );
}
