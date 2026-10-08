import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import Markdown from "react-markdown";
import { version as bundledVersion } from "../package.json";
import "./UpdateCenter.css";

const notesByVersion = import.meta.glob<string>("../docs/releases/*.md", { query: "?raw", import: "default", eager: true });
const currentNotes = notesByVersion[`../docs/releases/${bundledVersion}.md`] ?? "本版说明可在 GitHub 发布页查看。";

const RELEASES = "https://github.com/kobewl/TokenLens/releases";
type Phase = "idle" | "checking" | "current" | "available" | "downloading" | "installing" | "installed" | "error";
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Preferences are optional. */ } };
const explain = (e: unknown) => {
  const message = String(e);
  if (/404|release.*not found|valid release JSON/i.test(message)) return "尚未找到已发布的更新清单。可以在 GitHub 查看发布状态，稍后再试。";
  if (/signature|minisign|public.key/i.test(message)) return "更新包的签名验证未通过，已停止安装。请重试或从官方发布页下载安装。";
  if (/permission|denied|read.only/i.test(message)) return "无法写入应用目录。请把 TokenLens 移到“应用程序”后重试。";
  return "无法完成更新，请检查网络后重试；也可以从官方发布页下载安装。";
};
const size = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
export function useUpdates() {
  const desktop = isTauri();
  const [version, setVersion] = useState(bundledVersion);
  const [auto, setAuto] = useState(() => read("tokenlens-auto-update-check") !== "false");
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [dialog, setDialog] = useState<"available" | "whats-new" | null>(null);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState<number | undefined>();
  const [notify, setNotify] = useState(false);
  const resource = useRef<Update | null>(null);
  const locked = useRef(false);
  const installed = useRef(false);
  const mounted = useRef(false);
  const busy = phase === "checking" || phase === "downloading" || phase === "installing";
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (!locked.current) void resource.current?.close().catch(() => {}); };
  }, []);
  useEffect(() => { write("tokenlens-auto-update-check", String(auto)); }, [auto]);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void getVersion().then(v => {
      if (!active) return; setVersion(v);
      const previous = read("tokenlens-last-seen-version");
      if (previous && previous !== v) setDialog("whats-new");
      if (!previous) write("tokenlens-last-seen-version", v);
    }).catch(() => {});
    return () => { active = false; };
  }, [desktop]);
  const checkUpdates = useCallback(async (manual = true) => {
    if (!desktop || locked.current || installed.current) return;
    locked.current = true; setPhase("checking"); setError("");
    try {
      const next = await check({ timeout: 15000 });
      if (!mounted.current) { await next?.close(); return; }
      const old = resource.current; resource.current = next; setUpdate(next);
      if (old) void old.close().catch(() => {});
      setCheckedAt(new Date()); setPhase(next ? "available" : "current");
      if (next) {
        if (manual) setDialog("available");
        setNotify(read("tokenlens-dismissed-update") !== next.version);
      } else setNotify(false);
    } catch (e) { if (mounted.current) { setError(explain(e)); setPhase(resource.current ? "available" : "error"); } }
    finally { locked.current = false; }
  }, [desktop]);
  useEffect(() => {
    if (!desktop || !auto) return;
    const timer = setTimeout(() => void checkUpdates(false), 2500);
    return () => clearTimeout(timer);
  }, [desktop, auto, checkUpdates]);
  const install = async () => {
    const selected = resource.current;
    if (!selected || locked.current || installed.current) return;
    locked.current = true; setPhase("downloading"); setDownloaded(0); setTotal(undefined); setError("");
    let bytes = 0;
    try {
      await selected.downloadAndInstall(event => {
        if (!mounted.current) return;
        if (event.event === "Started") setTotal(event.data.contentLength);
        else if (event.event === "Progress") { bytes += event.data.chunkLength; setDownloaded(bytes); }
        else setPhase("installing");
      }, { timeout: 120000 });
      installed.current = true; resource.current = null; void selected.close().catch(() => {});
      if (mounted.current) { setPhase("installed"); setNotify(false); }
      // The replacement is installed; restarting remains an explicit user action.
    } catch (e) { if (mounted.current) { setError(explain(e)); setPhase("available"); } }
    finally { locked.current = false; }
  };
  const restart = async () => { try { await relaunch(); } catch { setError("重启未完成，请退出 TokenLens 后重新打开。更新已安装，无需再次下载。"); } };
  const dismissNotice = () => { if (update) write("tokenlens-dismissed-update", update.version); setNotify(false); };
  const closeDialog = () => {
    if (phase === "downloading" || phase === "installing") return;
    if (dialog === "whats-new") write("tokenlens-last-seen-version", version);
    if (dialog === "available" && update) { write("tokenlens-dismissed-update", update.version); setNotify(false); }
    setDialog(null);
  };
  const openRelease = async () => { try { await openUrl(RELEASES); } catch { setError("无法打开浏览器，请访问 github.com/kobewl/TokenLens/releases。"); } };
  return { desktop, version, auto, setAuto, phase, busy, update, dialog, setDialog, error, checkedAt, downloaded, total, notify, checkUpdates, install, restart, closeDialog, openRelease, dismissNotice };
}
type Controller = ReturnType<typeof useUpdates>;
export function UpdateSettings({ controller: u }: { controller: Controller }) {
  const label = u.phase === "checking" ? "正在检查…" : u.phase === "current" ? "已是最新版本" : u.phase === "installed" ? "更新已安装" : u.update ? `发现 v${u.update.version}` : "稳定版频道";
  return <section className="update-settings" aria-label="应用更新"><div className="update-identity"><span className="update-emblem">◈</span><div><strong>TokenLens <span>v{u.version}</span></strong><p>{label}</p></div><span className="release-channel">STABLE</span></div>
    <div className="update-setting-actions"><button className="outline primary" disabled={!u.desktop || u.busy || u.phase === "installed"} onClick={() => void u.checkUpdates(true)}>{u.phase === "checking" ? "正在检查…" : "检查更新"}</button>{u.update && <button className="outline" disabled={u.busy} onClick={() => u.setDialog("available")}>{u.phase === "installed" ? "重启以完成更新" : "查看新版本"}</button>}<button className="text-action" onClick={() => u.setDialog("whats-new")}>本版新功能 ↗</button></div>
    {u.error && <p className="update-error" role="alert">{u.error}<button onClick={() => void u.openRelease()}>查看发布页 ↗</button></p>}
    <div className="update-auto"><div><strong>启动时检查更新</strong><p>发现新版时提醒，下载与安装由你确认。</p></div><input type="checkbox" role="switch" aria-label="启动时检查更新" checked={u.auto} disabled={!u.desktop} onChange={e => u.setAuto(e.target.checked)} /></div>
    <div className="update-meta"><span>{!u.desktop ? "浏览器预览 · 请在桌面应用中检查更新" : u.checkedAt ? `上次检查 ${u.checkedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "更新包通过签名验证后安装"}</span><button className="text-action" onClick={() => void u.openRelease()}>GitHub Releases ↗</button></div>
  </section>;
}
export function UpdateDialogs({ controller: u }: { controller: Controller }) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(u.closeDialog); close.current = u.closeDialog;
  useEffect(() => {
    if (!u.dialog) return;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close.current(); }
      if (e.key !== "Tab") return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') ?? []);
      const first = items[0], last = items[items.length - 1];
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); if (before?.isConnected) before.focus(); };
  }, [u.dialog]);
  const upgrading = u.dialog === "available";
  const installing = u.phase === "downloading" || u.phase === "installing";
  const notes = upgrading ? u.update?.body || "此版本暂未提供说明，可在 GitHub 发布页查看详情。" : currentNotes;
  const percentage = u.total && u.total > 0 ? Math.min(100, Math.floor(u.downloaded / u.total * 100)) : undefined;
  if (!u.dialog) return u.notify && u.update ? <div className="update-toast" role="status"><span>✦ 新版 v{u.update.version} 可用</span><button onClick={() => u.setDialog("available")}>查看更新 →</button><button aria-label="稍后提醒更新" onClick={u.dismissNotice}>×</button></div> : null;
  return <div className="modal-backdrop update-backdrop" onClick={u.closeDialog}><section ref={panel} className="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title" onClick={e => e.stopPropagation()}><header className="update-dialog-head"><span className="update-spark">{upgrading ? "↓" : "✦"}</span><div><h2 id="update-title">{upgrading ? u.phase === "installed" ? "更新已就绪" : "有新版本可用" : "新功能"}</h2><p>{upgrading ? `v${u.version} → v${u.update?.version}` : `版本 ${u.version}`}</p></div><button aria-label="关闭更新窗口" disabled={installing} onClick={u.closeDialog}>×</button></header>
    <div className="update-dialog-body"><section className="update-welcome"><span className="eyebrow">{upgrading ? "READY FOR YOUR NEXT SESSION" : "BUILT FOR YOUR TOOLCHAIN"}</span><h3>{upgrading ? "新的能力，继续你的工作流。" : "让每个编辑器，都能接着工作。"}</h3><p>{upgrading ? "更新包将经过签名验证。安装完成后，你可以在方便时重启应用。" : "TokenLens 把工具、项目记忆和下一步放在一起。感谢你参与这个开源项目。"}</p></section>
      {upgrading && (installing || u.phase === "installed") && <section className="update-progress" aria-live="polite"><div><strong>{u.phase === "installed" ? "安装完成，等待重启" : u.phase === "installing" ? "正在验证并安装…" : "正在下载更新…"}</strong><span>{u.phase === "installed" ? "✓" : u.phase === "installing" ? "" : percentage === undefined ? size(u.downloaded) : `${percentage}%`}</span></div><progress aria-label="更新下载进度" max={100} value={u.phase === "installed" || u.phase === "installing" ? 100 : percentage} /><p>{u.phase === "installed" ? "请先保存其他工具里的工作，再重启 TokenLens。" : u.phase === "installing" ? "请保持应用打开。" : `${size(u.downloaded)}${u.total ? ` / ${size(u.total)}` : ""}`}</p></section>}
      {u.error && <p className="update-error" role="alert">{u.error}</p>}
      <div className="release-notes-heading"><h3>{upgrading ? `v${u.update?.version}` : `v${u.version}`}</h3>{upgrading && u.update?.date && Number.isFinite(Date.parse(u.update.date)) && <time>{new Date(u.update.date).toLocaleDateString("zh-CN")}</time>}<button className="text-action" onClick={() => void u.openRelease()}>了解更多 ↗</button></div>
      <div className="release-notes"><Markdown skipHtml components={{ img: () => null, a: ({ href, children }) => /^https:\/\//.test(href ?? "") ? <a href={href} onClick={e => { e.preventDefault(); void openUrl(href!).catch(() => {}); }}>{children} ↗</a> : <span>{children}</span> }}>{notes}</Markdown></div>
    </div><footer className="update-dialog-footer"><button className="text-action" onClick={() => void u.openRelease()}>GitHub ↗</button><div>{upgrading ? <><button className="outline" disabled={installing} onClick={u.closeDialog}>{u.phase === "installed" ? "稍后重启" : "稍后提醒"}</button><button className="outline primary" disabled={installing} onClick={() => void (u.phase === "installed" ? u.restart() : u.install())}>{u.phase === "installed" ? "立即重启" : installing ? "更新进行中…" : u.error ? "重试更新" : "下载并安装"}</button></> : <button className="outline primary" onClick={u.closeDialog}>知道了</button>}</div></footer>
  </section></div>;
}
