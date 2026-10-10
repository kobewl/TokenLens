import { useCallback, useEffect, useRef, useState } from "react";
import { Layers, RefreshCw } from "lucide-react";
import { toolName } from "./lib/catalog";
import { call as invoke } from "./lib/api";
import PageHeader from "./ui/PageHeader";
import ToolMark from "./ui/ToolMark";
import "./EditorMemoryHub.css";

type Entry = { id: string; tool: string; name: string; path: string; scope: string; project: string; kind: string; bytes: number; modifiedMs: number; readable: boolean };
type Report = { tool: string; detected: boolean; count: number; detail: string };
type Catalog = { entries: Entry[]; tools: Report[]; projects: { name: string; root: string }[]; warnings: string[] };
type Document = { content: string; fingerprint: string };
type Aggregation = { content: string; fingerprints: Record<string, string> };
type Preview = { id: string; target: string; before: string; after: string; changed: boolean };
type SyncResult = { target: string; backup: string | null; undoId: string };
const name = (tool: string) => (tool === "shared" ? "通用项目规范" : toolName(tool));
const bytes = (n: number) => n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KiB`;
export function useEditorMemoryCatalog() {
  // Browser demo mode answers every read command with fabricated data, so the UI stays explorable.
  const desktop = true;
  const [data, setData] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const generation = useRef(0);
  const scan = useCallback(async () => {
    if (!desktop) return;
    const id = ++generation.current; setLoading(true); setError("");
    try { const result = await invoke<Catalog>("scan_editor_memories"); if (id === generation.current) { setData(result); setCheckedAt(new Date()); } }
    catch (e) { if (id === generation.current) setError(String(e)); }
    finally { if (id === generation.current) setLoading(false); }
  }, [desktop]);
  useEffect(() => { void scan(); return () => { generation.current++; }; }, [scan]);
  return { desktop, data, loading, error, checkedAt, scan };
}
type Controller = ReturnType<typeof useEditorMemoryCatalog>;
export default function EditorMemoryHub({ catalog: c }: { catalog: Controller }) {
  const [tool, setTool] = useState("");
  const [scope, setScope] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState<Entry | null>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const [aggregate, setAggregate] = useState<(Aggregation & { ids: string[] }) | null>(null);
  const [mode, setMode] = useState<"source" | "aggregate" | "sync" | null>(null);
  const [root, setRoot] = useState("");
  const [targetTool, setTargetTool] = useState("cursor");
  const [agents, setAgents] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const nativeBusy = busy || c.loading;
  useEffect(() => { setPreview(null); setSelected(ids => ids.filter(id => c.data?.entries.some(e => e.id === id))); setRoot(r => c.data?.projects.some(p => p.root === r) ? r : c.data?.projects[0]?.root ?? ""); }, [c.data]);
  useEffect(() => {
    if (!mode) return;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); if (!lock.current) setMode(null); }
      if (e.key !== "Tab") return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea,input:not(:disabled),select,[tabindex="0"]') ?? []);
      const first = items[0], last = items[items.length - 1];
      if (!first) return;
      if (e.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); if (before?.isConnected) before.focus(); };
  }, [mode]);
  async function action(run: () => Promise<void>) {
    if (lock.current || c.loading) return; lock.current = true; setBusy(true); setError(""); setMessage("");
    try { await run(); } catch (e) { setError(String(e)); } finally { lock.current = false; setBusy(false); }
  }
  async function view(entry: Entry) {
    setDoc(null); setActive(entry); setMode("source");
    await action(async () => { setDoc(await invoke<Document>("read_editor_memory", { id: entry.id })); });
  }
  async function addProject() { await action(async () => { const project = await invoke("add_project"); if (project) await c.scan(); }); }
  async function combine() {
    await action(async () => { const merged = await invoke<Aggregation>("aggregate_editor_memories", { ids: selected }); setAggregate({ ...merged, ids: [...selected] }); setMode("aggregate"); setPreview(null); });
  }
  function toggle(entry: Entry) {
    setError(""); setSelected(ids => ids.includes(entry.id) ? ids.filter(id => id !== entry.id) : ids.length < 20 ? [...ids, entry.id] : (setError("最多选择 20 份记忆，请减少选择。"), ids));
  }
  async function copy(content: string) { try { await navigator.clipboard.writeText(content); setMessage("已复制。"); } catch { setError("复制失败，请选择文本手动复制。"); } }
  function syncSingle() { if (!active || !doc) return; setAggregate({ ids: [active.id], content: doc.content, fingerprints: { [active.id]: doc.fingerprint } }); setPreview(null); setAgents(false); setMode("sync"); }
  const all = [...(c.data?.entries ?? [])].sort((a,b) => name(a.tool).localeCompare(name(b.tool)) || a.project.localeCompare(b.project) || a.path.localeCompare(b.path));
  const entries = all.filter(e => (!tool || e.tool === tool) && (!scope || e.scope === scope) && `${name(e.tool)} ${e.project} ${e.name} ${e.path}`.toLowerCase().includes(query.toLowerCase()));
  const reports = c.data?.tools ?? [];
  const [showAll, setShowAll] = useState(false);
  const tools = reports.filter(r => showAll || r.detected || r.count > 0);
  const needsAgents = ["codex", "opencode"].includes(targetTool);
  return <div className="native-memory page">
    <PageHeader title="编辑器记忆" subtitle="自动发现 · 独立查看 · 点击后才汇总。各编辑器的原始记忆保持独立。" actions={<button className="btn" disabled={nativeBusy || !c.desktop} onClick={() => void c.scan()}><RefreshCw size={14} className={c.loading ? "spin" : ""} />{c.loading ? "正在扫描…" : "重新扫描"}</button>} />
    {(c.error || error) && <p className="error" role="alert">{error || c.error}</p>}{message && <p className="notice" role="status">{message}</p>}
    {!c.desktop && <p className="notice">浏览器预览 · 请在桌面应用中扫描本机编辑器记忆。</p>}
    <div className="native-summary"><span><strong>{all.length}</strong> 份原始记忆 / 规则</span><span><strong>{reports.filter(r => r.count > 0).length}</strong> 个工具来源</span><span><strong>{c.data?.projects.length ?? 0}</strong> 个已发现项目</span><small>未自动汇总，原文件保持独立</small></div>
    {c.data?.warnings.map((w, i) => <p className="notice" key={i}>{w}</p>)}
    <div className="native-layout"><aside className="native-tool-list"><span className="nav-label">按编辑器查看</span><button className={!tool ? "active" : ""} onClick={() => setTool("")}><Layers size={20} /><strong>全部来源</strong><small>{all.length}</small></button>{tools.map(r => <button key={r.tool} className={tool === r.tool ? "active" : ""} onClick={() => setTool(r.tool)}><ToolMark id={r.tool} size={22} /><strong>{name(r.tool)}</strong><small>{r.count}</small></button>)}<button className="text-action" onClick={() => setShowAll(v => !v)}>{showAll ? "收起未发现的工具" : "查看所有适配工具"}</button><div className="native-scan-note"><strong>从哪里发现？</strong><p>工具记忆目录、最近工作区，以及 Projects / Developer 等常用项目目录。</p><button className="text-action" disabled={!c.desktop || nativeBusy} onClick={() => void addProject()}>补充项目目录 →</button></div></aside>
      <section className="native-files"><div className="native-filters"><input aria-label="搜索编辑器记忆" placeholder="搜索项目、文件或路径" value={query} onChange={e => setQuery(e.target.value)} /><div className="segments">{[["", "全部"], ["global", "全局"], ["project", "项目"]].map(([id, label]) => <button key={id} className={scope === id ? "active" : ""} onClick={() => setScope(id)}>{label}</button>)}</div></div>
        {tool && <p className="native-tool-detail">{reports.find(r => r.tool === tool)?.detail}</p>}
        <div className="native-selection"><label><input type="checkbox" aria-label="选择当前列表记忆" disabled={!entries.some(e => e.readable) || nativeBusy} checked={entries.filter(e => e.readable).length > 0 && entries.filter(e => e.readable).every(e => selected.includes(e.id))} onChange={e => setSelected(e.target.checked ? entries.filter(e => e.readable).slice(0, 20).map(e => e.id) : [])} />选中 {selected.length} / 20 份</label><button className="outline primary" disabled={!selected.length || nativeBusy} onClick={() => void combine()}>汇总选中记忆</button>{selected.length > 0 && <button className="text-action" onClick={() => setSelected([])}>清除选择</button>}{aggregate && <button className="text-action" disabled={nativeBusy} onClick={() => setMode("aggregate")}>查看上次汇总 →</button>}</div>
        {c.loading && !c.data ? <div className="native-empty"><span>◌</span><h3>正在发现本机记忆…</h3><p>扫描只读取文件索引，不会自动合并或同步内容。</p></div> : entries.length ? <div className="native-file-list">{entries.map(e => <article key={e.id}><input type="checkbox" aria-label={`选择 ${name(e.tool)} ${e.name}`} disabled={!e.readable || nativeBusy} checked={selected.includes(e.id)} onChange={() => toggle(e)} /><span className="native-file-mark"><ToolMark id={e.tool} size={32} /></span><div><div className="native-file-title"><strong>{e.name}</strong><span>{e.kind === "memory" ? "原生记忆" : "规则 / 指令"}</span></div><p>{name(e.tool)} · {e.scope === "global" ? "全局" : e.project} · {bytes(e.bytes)}</p><small title={e.path}>{e.path}</small></div><button className="outline" disabled={!e.readable || nativeBusy} onClick={() => void view(e)}>{e.readable ? "查看原文" : "文件过大"}</button></article>)}</div> : <div className="native-empty"><span>⌑</span><h3>{all.length ? "没有匹配的记忆" : "暂未发现本机记忆文件"}</h3><p>{all.length ? "调整编辑器、范围或搜索条件。" : "已扫描支持的工具目录和最近项目。可以补充项目目录再扫描；云端记忆和未适配的私有格式不会被当作本机文件。"}</p>{!all.length && <button className="outline" disabled={!c.desktop || nativeBusy} onClick={() => void addProject()}>补充项目目录</button>}</div>}
        <p className="native-footnote">各来源保持独立。汇总保留原文和来源，不会自动消解规则冲突；同步只在你选择目标并确认后写入。</p>
      </section></div>
    {result && <section className="native-sync-result" role="status"><div><strong>已同步到 {result.target}</strong><p>{result.backup ? `原文件备份：${result.backup}` : "创建了独立的规则文件。"}</p></div><button className="outline" disabled={nativeBusy} onClick={() => void action(async () => { await invoke("undo_editor_sync", { id: result.undoId }); setResult(null); setMessage("已恢复同步前的内容。"); await c.scan(); })}>撤销本次同步</button></section>}
    {mode && <div className="modal-backdrop native-modal-backdrop" onClick={() => { if (!busy) setMode(null); }}><section ref={panel} className={`modal native-modal ${mode === "sync" ? "native-sync-modal" : ""}`} role="dialog" aria-modal="true" aria-label={mode === "source" ? "原始记忆" : mode === "aggregate" ? "选中记忆汇总" : "同步到编辑器"} onClick={e => e.stopPropagation()}><div className="modal-head"><div><h2>{mode === "source" ? active?.name : mode === "aggregate" ? "选中记忆汇总" : "同步到编辑器"}</h2><p>{mode === "source" ? `${name(active?.tool ?? "")} · ${active?.path}` : "仅包含你明确选择的来源，可在写入前编辑内容。"}</p></div><button aria-label="关闭编辑器记忆窗口" disabled={busy} onClick={() => setMode(null)}>×</button></div>
      {error && <p className="error" role="alert">{error}</p>}
      {mode === "source" ? <><textarea className="native-document" aria-label="原始记忆内容" readOnly value={doc?.content ?? (busy ? "正在读取…" : "")} /><div className="native-modal-actions"><button className="outline" disabled={!doc || busy} onClick={() => void copy(doc!.content)}>复制原文</button><button className="outline" disabled={!doc || busy || !active} onClick={() => active && toggle(active)}>{active && selected.includes(active.id) ? "移出汇总选择" : "加入汇总选择"}</button><button className="outline primary" disabled={!doc || nativeBusy} onClick={syncSingle}>同步这份记忆</button></div></> : mode === "aggregate" ? <><p className="native-tool-detail">{aggregate?.ids.length} 份来源 · 点击“汇总”后生成，不会自动更新。</p><textarea className="native-document" aria-label="记忆汇总内容" value={aggregate?.content ?? ""} onChange={e => { setAggregate(a => a ? { ...a, content: e.target.value } : a); setPreview(null); }} /><div className="native-modal-actions"><button className="outline" onClick={() => void copy(aggregate?.content ?? "")}>复制汇总</button><button className="outline primary" disabled={!aggregate?.content.trim() || nativeBusy} onClick={() => { setPreview(null); setAgents(false); setMode("sync"); }}>选择同步目标 →</button></div></> : <>
        <div className="native-targets"><label>目标项目<select aria-label="同步目标项目" value={root} disabled={busy} onChange={e => { setRoot(e.target.value); setPreview(null); setAgents(false); }}>{!c.data?.projects.length && <option value="">请先补充项目目录</option>}{c.data?.projects.map(p => <option key={p.root} value={p.root}>{p.name} · {p.root}</option>)}</select></label><label>目标编辑器<select aria-label="同步目标编辑器" value={targetTool} disabled={busy} onChange={e => { setTargetTool(e.target.value); setPreview(null); setAgents(false); }}>{["cursor", "claude-code", "codex", "gemini-cli", "kiro", "windsurf", "opencode", "vscode-copilot"].map(id => <option key={id} value={id}>{name(id)}</option>)}</select></label></div>
        {needsAgents && <label className="native-agents-optin"><input type="checkbox" checked={agents} disabled={busy} onChange={e => { setAgents(e.target.checked); setPreview(null); }} />允许更新此项目 AGENTS.md 的 TokenLens 标记块</label>}
        <p className="native-tool-detail">写入目标编辑器支持的项目规则文件，保留原有内容；已有文件先备份。不会改写编辑器的内部自动记忆库。</p>
        {preview ? <><p className="native-target-path">{preview.target}</p><div className="native-diff"><label>同步前<textarea aria-label="同步前内容" readOnly value={preview.before || "（文件不存在，将新建）"} /></label><label>同步后<textarea aria-label="同步后内容" readOnly value={preview.after} /></label></div><div className="native-modal-actions"><button className="outline" disabled={nativeBusy} onClick={() => setPreview(null)}>调整目标</button><button className="outline primary" disabled={!preview.changed || nativeBusy} onClick={() => void action(async () => { const saved = await invoke<SyncResult>("apply_editor_sync", { id: preview.id }); setResult(saved); setMode(null); setPreview(null); await c.scan(); })}>{busy ? "正在同步…" : preview.changed ? "确认同步" : "内容已一致"}</button></div></> : <div className="native-modal-actions"><button className="outline" disabled={busy} onClick={() => setMode("aggregate")}>查看汇总</button><button className="outline primary" disabled={!root || !aggregate || nativeBusy || (needsAgents && !agents)} onClick={() => void action(async () => { setPreview(await invoke<Preview>("preview_editor_sync", { ids: aggregate!.ids, root, tool: targetTool, content: aggregate!.content, allowAgents: agents, fingerprints: aggregate!.fingerprints })); })}>预览同步差异</button></div>}
      </>}
    </section></div>}
  </div>;
}
