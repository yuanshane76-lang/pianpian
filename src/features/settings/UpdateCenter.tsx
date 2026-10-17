import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Download, LoaderCircle, RefreshCw, ShieldCheck, X } from "lucide-react";
import { getDesktopBridge } from "../../platform/electron";
import { Pianpian } from "../../brand/Pianpian";
import "./UpdateCenter.css";

interface UpdateState {
  phase: "idle" | "unsupported" | "checking" | "current" | "available" | "downloading" | "downloaded" | "preparing" | "installing" | "error";
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  message?: string;
  progress?: number;
  open?: boolean;
}
export function UpdateCenter({ showTrigger = true, busy = false }: { showTrigger?: boolean; busy?: boolean }) {
  const bridge = getDesktopBridge();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<UpdateState>({ phase: "idle", currentVersion: "" });
  const [error, setError] = useState("");
  const dialog = useRef<HTMLElement>(null), previousFocus = useRef<HTMLElement | null>(null);
  const locked = state.phase === "preparing" || state.phase === "installing";
  async function action(name: string) {
    if (!bridge) return;
    setError("");
    if (name === "install") setState(current => ({ ...current, phase: "preparing", message: "正在保存当前记录…" }));
    try {
      const next = await bridge.invoke<UpdateState>(`zhiyan:update:${name}`);
      if (next?.phase) setState(next);
    } catch {
      setError("暂时无法完成操作。请确认没有正在生成的回答或解析任务，并检查磁盘空间后重试。");
      if (name === "install") setState(current => ({ ...current, phase: "downloaded" }));
    }
  }
  function show() { previousFocus.current = document.activeElement as HTMLElement; setOpen(true); void action("state"); }
  function close() { if (!locked) { setOpen(false); previousFocus.current?.focus(); } }
  useEffect(() => {
    if (!bridge?.isDesktop) return;
    const showFromEvent = () => show();
    window.addEventListener("pianpian:updates:open", showFromEvent);
    const unsubscribe = bridge?.on?.<UpdateState>("zhiyan:update:event", (next) => {
      if (!next?.phase) return;
      setState(next);
      if (next.open) { previousFocus.current = document.activeElement as HTMLElement; setOpen(true); }
    });
    return () => { window.removeEventListener("pianpian:updates:open", showFromEvent); unsubscribe?.(); };
  }, [bridge]);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const background = [...document.body.children].filter(child => child !== element?.parentElement);
    const prior = background.map(child => [child, child.hasAttribute("inert")] as const);
    for (const [child] of prior) child.setAttribute("inert", "");
    element?.querySelector<HTMLElement>("button")?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab") return;
      const controls = [...element!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')];
      const first = controls[0], last = controls.at(-1);
      if (!element?.contains(document.activeElement) || !event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    }
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("keydown", keyboard); for (const [child, inert] of prior) if (!inert) child.removeAttribute("inert"); };
  }, [open, locked]);
  if (!bridge?.isDesktop) return null;
  const working = ["checking", "downloading", "preparing", "installing"].includes(state.phase);
  const heading = ({ current: "篇篇已经是最新版本", available: "有新的篇篇，等你更新", downloading: "正在准备新的篇篇", downloaded: "新版本准备好了", preparing: "先把阅读记录收好", installing: "我们马上再见", error: "这次没能完成更新", unsupported: "安装版可以自动更新" } as Record<string, string>)[state.phase] || "让篇篇保持最新";
  return <>
    {showTrigger ? <button className="nav-item" type="button" aria-label="检查更新" onClick={show}><RefreshCw size={17} /><span>检查更新</span></button> : null}
    {open ? createPortal(<div className="update-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialog} className="update-dialog" role="dialog" aria-modal="true" aria-label="篇篇更新" aria-describedby="update-preservation">
        <header><span>篇篇更新</span><button className="icon-button" aria-label="关闭更新窗口" type="button" disabled={locked} onClick={close}><X size={18} /></button></header>
        <div className="update-hero"><Pianpian variant="reading" /><div><h2>{heading}</h2><p>当前版本 {state.currentVersion || "正在读取…"}{state.latestVersion ? ` → ${state.latestVersion}` : ""}</p></div></div>
        <p className="update-status" role={state.phase === "error" ? "alert" : "status"}>{working ? <LoaderCircle size={16} className="spin" /> : state.phase === "current" ? <Check size={16} /> : null}{state.message}</p>
        {state.phase === "downloading" ? <div className="update-progress" role="progressbar" aria-label="更新下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.progress || 0)}><span style={{ width: `${state.progress || 0}%` }} /><small>{Math.round(state.progress || 0)}%</small></div> : null}
        {state.releaseNotes ? <details className="update-notes" open><summary>这次更新了什么</summary><p>{state.releaseNotes}</p></details> : null}
        <div className="update-preservation" id="update-preservation"><ShieldCheck size={20} /><div><strong>论文和阅读记录不会被替换</strong><p>安装前先保存记录并备份关键数据，只更新程序。下载完成后，也由你决定何时重启。</p></div></div>
        {busy && state.phase === "downloaded" ? <p className="update-error">请先等待当前回答、论文导入或解析结束，再重启更新。</p> : null}
        {error ? <p className="update-error" role="alert">{error}</p> : null}
        <footer><button className="secondary-button" type="button" disabled={locked} onClick={close}>{state.phase === "downloaded" ? "稍后再说" : "关闭"}</button>
          {state.phase === "downloaded" ? <button className="primary-button" type="button" disabled={busy} onClick={() => void action("install")}><RefreshCw size={16} />重启并更新</button>
            : state.phase === "available" ? <button className="primary-button" type="button" onClick={() => void action("download")}><Download size={16} />下载更新</button>
            : state.phase === "unsupported" ? <button className="primary-button" type="button" onClick={() => void action("releases")}>前往下载页</button>
            : !working ? <button className="primary-button" type="button" onClick={() => void action("check")}><RefreshCw size={16} />{state.phase === "error" ? "重新检查" : "检查更新"}</button> : null}
        </footer>
      </section>
    </div>, document.body) : null}
  </>;
}
