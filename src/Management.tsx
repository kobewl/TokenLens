import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import "./Management.css";

type Source = { app: string; events: number; coverage: string; detail: string };
type Project = { root: string; name: string; guidance: boolean };
type Event = { id: number; ts: string; tool: string; summary: string; done: string[]; next: string[] };
type Decision = { id: number; ts: string; tool: string; title: string; rationale: string; status: string; supersededBy: number | null };
type Memory = { events: Event[]; decisions: Decision[]; eventCount: number; decisionCount: number; brief: string };
type Totals = { totalTokens: number; eventCount: number; byApp: { name: string; totalTokens: number }[] };
const TOOLS = [
  { id: "claude-code", name: "Claude Code", kind: "CLI", mark: "✳", about: "终端编码与项目探索", memory: true },
  { id: "codex", name: "Codex", kind: "CLI", mark: "◎", about: "编码任务与项目协作", memory: true },
  { id: "zcode", name: "ZCode", kind: "CLI", mark: "Z", about: "终端开发与多模型协作", memory: true },
  { id: "cursor", name: "Cursor", kind: "IDE", mark: "⬡", about: "编辑器内的 AI 开发", memory: true },
  { id: "gemini-cli", name: "Gemini CLI", kind: "CLI", mark: "✦", about: "终端编码与上下文处理", memory: true },
  { id: "kiro", name: "Kiro", kind: "IDE", mark: "◈", about: "规范与任务驱动开发", memory: true },
  { id: "opencode", name: "OpenCode", kind: "CLI", mark: "▣", about: "开源终端编码工具", memory: true },
  { id: "codemate", name: "CodeMate", kind: "IDE", mark: "C", about: "自研编码工作流", memory: true },
  { id: "antigravity", name: "Antigravity", kind: "IDE", mark: "△", about: "Agent 开发工作台", memory: true },
  { id: "windsurf", name: "Windsurf", kind: "IDE", mark: "≈", about: "编辑器与编码助手", memory: true },
  { id: "trae", name: "Trae", kind: "IDE", mark: "T", about: "AI 开发环境", memory: true },
  { id: "vscode-copilot", name: "VS Code Copilot", kind: "IDE", mark: "⌘", about: "编辑器内的编码助手", memory: true },
  { id: "claude-desktop", name: "Claude Desktop", kind: "桌面", mark: "✳", about: "桌面对话与工具调用", memory: true },
  { id: "chatgpt", name: "ChatGPT", kind: "桌面", mark: "◎", about: "对话与项目辅助", memory: false },
];
const STATUS: Record<string, string> = { counted: "已采集", partial: "部分采集", missing: "未发现记录", unavailable: "用量待支持", error: "采集异常" };
const format = (n: number) => new Intl.NumberFormat("zh-CN").format(n);
const date = (ts: string) => new Date(ts).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });
const lines = (s: string) => s.split("\n").map(s => s.trim()).filter(Boolean);
export default function Management({ page, sources, revision, onUsage, onMemory, onTools }: { page: "hub" | "tools" | "memory"; sources: Source[]; revision: number; onUsage: (app: string) => void; onMemory: () => void; onTools: () => void }) {
  const desktop = isTauri();
  const [projects, setProjects] = useState<Project[]>([]);
  const [root, setRoot] = useState("");
  const [memory, setMemory] = useState<Memory | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<"handoff" | "decision" | "connect" | "forget" | null>(null);
  const [tool, setTool] = useState("codex");
  const [summary, setSummary] = useState("");
  const [done, setDone] = useState("");
  const [next, setNext] = useState("");
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [supersedes, setSupersedes] = useState("");
  const [config, setConfig] = useState("");
  const [guidance, setGuidance] = useState(false);
  const generation = useRef(0);
  const project = projects.find(p => p.root === root);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void invoke<Project[]>("list_projects").then(p => {
      if (!active) return; setProjects(p); setRoot(r => p.some(x => x.root === r) ? r : p[0]?.root ?? "");
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [desktop, version]);
  useEffect(() => {
    if (!desktop || (page !== "tools" && page !== "hub")) return;
    let active = true;
    void invoke<Totals>("overview", { range: "all", app: null, provider: null, model: null }).then(t => { if (active) setTotals(t); }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [desktop, page, revision]);
  useEffect(() => {
    const id = ++generation.current; setMemory(null); setError("");
    if (!desktop || !root || (page !== "memory" && page !== "hub")) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      void invoke<Memory>("project_memory", { root, query: page === "hub" ? "" : query }).then(m => { if (id === generation.current) setMemory(m); }).catch(e => { if (id === generation.current) setError(String(e)); }).finally(() => { if (id === generation.current) setLoading(false); });
    }, 120);
    return () => { clearTimeout(timer); generation.current++; };
  }, [desktop, root, query, page, version, revision]);
  useEffect(() => {
    setConfig("");
    if (!desktop || !root || dialog !== "connect") return;
    let active = true;
    void invoke<string>("memory_config", { root, tool }).then(c => { if (active) setConfig(c); }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [desktop, root, tool, dialog, version]);
  useEffect(() => {
    if (!dialog) return;
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setDialog(null); };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [dialog, busy]);
  async function action(run: () => Promise<void>) {
    if (busy) return; setBusy(true); setError(""); setMessage("");
    try { await run(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  function addProject() { void action(async () => { const p = await invoke<Project | null>("add_project"); if (p) { setRoot(p.root); setVersion(v => v + 1); onMemory(); } }); }
  function openForm(kind: typeof dialog) { setSummary(""); setDone(""); setNext(""); setTitle(""); setRationale(""); setSupersedes(""); setGuidance(false); setError(""); setDialog(kind); }
  async function saveRecord() {
    await action(async () => {
      const result = await invoke<{ id: number; warning: string | null }>(dialog === "handoff" ? "write_handoff" : "write_decision", { root, input: dialog === "handoff" ? { tool, summary, done: lines(done), next: lines(next) } : { tool, title, rationale, supersedes: supersedes ? Number(supersedes) : null } });
      setMessage(result.warning ? `记录已保存。视图更新告警：${result.warning}` : "记录已保存，交接简报已更新。"); setDialog(null); setQuery(""); setVersion(v => v + 1);
    });
  }
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); setMessage("已复制，可交给下一个工具继续工作。"); } catch { setError("复制失败，请在文本框中选择并复制内容。"); } }
  const filtered = TOOLS.filter(t => (category === "全部" || category === t.kind) && `${t.name} ${t.about}`.toLowerCase().includes(keyword.toLowerCase()));
  return <div className="management">
    {error && <p className="error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    {!desktop && <p className="notice">浏览器预览 · 请在桌面应用中添加本机项目、采集用量和写入记忆。</p>}
    {page === "hub" ? <>
      <section className="command-banner"><div><span className="eyebrow">TOKENLENS / AI EDITOR HUB</span><h2>换个工具，接着推进。</h2><p>项目、交接与决策，在这里连成一条工作线。</p><button className="outline primary" disabled={!desktop || busy} onClick={addProject}>＋ 添加项目</button></div><div className="handoff-orbit" aria-hidden="true"><span>⌘ IDE</span><i>↘</i><strong>◈<small>项目记忆</small></strong><i>↗</i><span>CLI ⌁</span></div></section>
      <div className="command-layout"><div className="command-main">
        <section className="workspace-panel"><div className="panel-title"><div><span className="eyebrow">PROJECTS</span><h3>项目工作区 <small>{projects.length}</small></h3></div><button className="text-action" onClick={onMemory}>管理项目 →</button></div>
          {projects.length ? <><div className="project-switcher">{projects.map(p => <button key={p.root} className={root === p.root ? "active" : ""} onClick={() => { setRoot(p.root); setQuery(""); }}><span className="folder-mark">⌑</span><strong>{p.name}</strong><small title={p.root}>{p.root}</small></button>)}</div><div className="project-resume"><span className="eyebrow">当前项目 / {project?.name}</span><h3>{loading ? "正在读取交接…" : memory?.events[0]?.summary ?? "给下一次工作留一个起点"}</h3><p>{memory?.events[0] ? `上次记录来自 ${TOOLS.find(t => t.id === memory.events[0].tool)?.name ?? memory.events[0].tool} · ${date(memory.events[0].ts)}` : "写下进度和下一步，让其他编辑器接着完成。"}</p><div className="resume-actions"><button className="outline primary" disabled={!memory || loading} onClick={() => void copy(memory!.brief)}>复制交接简报</button><button className="outline" disabled={busy} onClick={() => openForm("handoff")}>写交接</button><button className="text-action" onClick={onMemory}>查看完整记忆 →</button></div></div></> : <div className="workspace-onboarding"><span className="folder-mark">⌑</span><h3>把第一个项目带进来</h3><p>选择项目目录，集中保存交接、下一步和决策。</p><button className="outline" disabled={!desktop || busy} onClick={addProject}>选择项目目录 →</button></div>}
        </section>
        <section className="workspace-panel"><div className="panel-title"><div><span className="eyebrow">NEXT UP</span><h3>接下来做什么</h3></div>{project && <button className="text-action" onClick={onMemory}>交接历史 →</button>}</div>{loading ? <p className="panel-empty">正在读取…</p> : memory?.events[0]?.next.length ? <ol className="next-queue">{memory.events[0].next.map((item,i) => <li key={i}><span>{String(i+1).padStart(2,"0")}</span><p>{item}</p></li>)}</ol> : <p className="panel-empty">{project ? "最新交接还没有下一步。写交接时留下待办，方便切换工具后继续。" : "添加项目后，这里会显示最新交接中的下一步。"}</p>}</section>
      </div><aside className="command-rail">
        <section className="workspace-panel"><div className="panel-title"><div><span className="eyebrow">YOUR TOOLCHAIN</span><h3>工具与接入</h3></div><button className="text-action" onClick={onTools}>全部 →</button></div><div className="toolchain-list">{TOOLS.slice(0,5).map(t => { const source=sources.find(s=>s.app===t.id); return <button key={t.id} onClick={onTools}><span className={`tool-symbol symbol-${t.id}`}>{t.mark}</span><span><strong>{t.name}</strong><small>{source ? STATUS[source.coverage] ?? source.coverage : "未检测用量"}</small></span><span className="tool-kind">{t.kind}</span></button>; })}</div><button className="outline rail-connect" disabled={!project || busy} onClick={() => openForm("connect")}>为当前项目接入工具 ↗</button><p className="rail-note">用量状态来自本机记录；目录不表示已安装或已连接。</p></section>
        <section className="usage-glance"><span className="eyebrow">USAGE / ALL TIME</span><h3>{format(totals?.totalTokens ?? 0)} <small>Tokens</small></h3><p>{format(totals?.eventCount ?? 0)} 次请求 · {sources.filter(s=>s.events>0).length} 个工具有记录</p><button className="text-action" onClick={() => onUsage("")}>查看用量统计 →</button></section>
        <div className="local-workflow"><span>◈ 本地工作流</span><p>一份项目记忆，多个工具接棒。交接由你或接入的工具明确写入。</p></div>
      </aside></div>
    </> : page === "tools" ? <>

      <section className="hub-intro"><div><span className="eyebrow">你的 AI 工作台</span><h2>你的工具链，各就各位。</h2><p>集中查看工具覆盖与用量，把进度、决策和下一步交给同一份项目记忆。</p></div><button className="outline" onClick={onMemory}>查看项目记忆 →</button></section>
      <div className="hub-stats"><article><span>工具目录</span><strong>{TOOLS.length}</strong><small>CLI · IDE · 桌面</small></article><article><span>已有用量的工具</span><strong>{sources.filter(s => s.events > 0).length}</strong><small>来自本机可核对的记录</small></article><article><span>累计 Token</span><strong>{format(totals?.totalTokens ?? 0)}</strong><small>{format(totals?.eventCount ?? 0)} 次请求</small></article><article><span>已管理项目</span><strong>{projects.length}</strong><small>每个项目独立存放记忆</small></article></div>
      <div className="hub-toolbar"><div className="segments">{["全部", "CLI", "IDE", "桌面"].map(c => <button key={c} className={category === c ? "active" : ""} onClick={() => setCategory(c)}>{c}</button>)}</div><input aria-label="搜索 AI 工具" placeholder="搜索工具或用途" value={keyword} onChange={e => setKeyword(e.target.value)} /></div>
      <div className="tool-grid">{filtered.map(t => { const source = sources.find(s => s.app === t.id); const tokens = totals?.byApp.find(a => a.name === t.name)?.totalTokens; return <article className="tool-card" key={t.id}><div className="tool-card-head"><span className="tool-symbol">{t.mark}</span><div><h3>{t.name}</h3><span>{t.kind}</span></div><span className={`coverage-status ${source?.coverage ?? ""}`}>{source ? STATUS[source.coverage] ?? source.coverage : "未检测用量"}</span></div><p>{t.about}</p><div className="tool-usage"><strong>{tokens === undefined ? "—" : format(tokens)}</strong><span>累计 Token</span></div><p className="tool-detail">{source?.detail ?? "暂无可核对的本机用量。记忆接入可从项目页配置。"}</p><div className="tool-card-actions"><button className="outline" disabled={!source?.events} onClick={() => onUsage(t.id)}>查看用量</button><button className="outline" onClick={onMemory}>{t.memory ? "接入项目记忆" : "查看交接简报"}</button></div></article>; })}</div>
      {!filtered.length && <div className="hub-empty">未找到匹配的工具。</div>}
      <p className="muted hub-footnote">工具目录不代表已安装。用量状态来自采集器；MCP 片段是通用配置，接入后仍需在对应工具中验证。</p>
    </> : <>
      <div className="memory-heading"><div><span className="eyebrow">One project, one memory</span><h2>项目记忆与交接</h2><p>记录已完成、下一步和决策理由，让切换工具也能接着工作。</p></div><button className="outline" disabled={!desktop || busy} onClick={addProject}>＋ 添加项目</button></div>
      <div className="memory-layout"><aside className="project-list"><h3>我的项目 <small>{projects.length}</small></h3>{projects.map(p => <button key={p.root} className={root === p.root ? "active" : ""} onClick={() => { setRoot(p.root); setQuery(""); setMessage(""); }}><strong>{p.name}</strong><span title={p.root}>{p.root}</span></button>)}{!projects.length && <p className="muted">添加项目目录后，在这里查看共享记忆。</p>}</aside><div className="memory-workspace">
        {!project ? <div className="hub-empty"><strong>先选一个项目，开始接棒。</strong><p>添加目录只登记项目；首次写入才创建记忆库。不会读取各工具的私有记忆。</p><button className="outline" disabled={!desktop || busy} onClick={addProject}>添加项目</button></div> : <>
          <div className="project-heading"><div><h3>{project.name}</h3><p title={project.root}>{project.root}</p></div><button className="outline" disabled={busy} onClick={() => openForm("connect")}>接入工具</button><button className="outline" disabled={busy} onClick={() => openForm("forget")}>移出列表</button></div>
          <div className="memory-actions"><button className="outline" disabled={busy} onClick={() => openForm("handoff")}>写交接</button><button className="outline" disabled={busy} onClick={() => openForm("decision")}>记决策</button><button className="outline" disabled={busy} onClick={() => void action(async () => { await invoke("rebuild_memory", { root, enableGuidance: false }); setVersion(v => v + 1); setMessage("交接视图已重建。"); })}>重建简报</button><input aria-label="搜索项目记忆" maxLength={200} placeholder="搜索摘要或决策，例如：登录" value={query} onChange={e => setQuery(e.target.value)} /></div>
          {loading ? <p className="muted">正在读取项目记忆…</p> : memory && <>
            {!query && <section className="brief-card"><div className="brief-head"><h3>当前交接简报</h3><button className="outline" onClick={() => void copy(memory.brief)}>复制简报</button></div><textarea aria-label="交接简报" readOnly value={memory.brief} /><span className="muted">{memory.eventCount} 条交接 · {memory.decisionCount} 条决策 · 摘要由明确记录生成</span></section>}
            <section className="memory-section"><h3>{query ? "匹配的交接" : "交接历史"} <small>最近 {memory.events.length} 条</small></h3>{memory.events.map(e => <article className="record-card" key={e.id}><div><span>#{e.id} · {TOOLS.find(t => t.id === e.tool)?.name ?? e.tool}</span><time>{date(e.ts)}</time></div><p>{e.summary}</p>{e.done.length > 0 && <details><summary>已完成 {e.done.length} 项</summary><ul>{e.done.map((d, i) => <li key={i}>{d}</li>)}</ul></details>}{e.next.length > 0 && <div className="next-list"><strong>下一步</strong><ul>{e.next.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}</article>)}{!memory.events.length && <p className="muted">{query ? "没有匹配的交接摘要。" : "还没有交接，写下本次进度和下一步。"}</p>}</section>
            <section className="memory-section"><h3>{query ? "匹配的决策" : "决策与演化"}</h3>{memory.decisions.map(d => <article className={`record-card decision ${d.status}`} key={d.id}><div><span>D{d.id} · {d.tool}</span><span className="coverage-status">{d.status === "active" ? "有效" : `已被 D${d.supersededBy} 取代`}</span><time>{date(d.ts)}</time></div><h4>{d.title}</h4><p>{d.rationale}</p></article>)}{!memory.decisions.length && <p className="muted">{query ? "没有匹配的决策。" : "记下选择与理由，后续取代旧决策时保留完整历史。"}</p>}</section>
          </>}
        </>}
      </div></div>
    </>}
    {dialog && <div className="modal-backdrop" onClick={() => { if (!busy) setDialog(null); }}><section className="modal memory-modal" role="dialog" aria-modal="true" aria-label={{ handoff: "写交接", decision: "记决策", connect: "接入工具", forget: "移出项目" }[dialog]} onClick={e => e.stopPropagation()}><div className="modal-head"><h2>{{ handoff: "写交接", decision: "记决策", connect: "接入工具", forget: "移出项目" }[dialog]}</h2><button autoFocus aria-label="关闭记忆窗口" disabled={busy} onClick={() => setDialog(null)}>×</button></div>
      {error && <p className="error" role="alert">{error}</p>}
      {dialog === "forget" ? <><p>只从管理列表移除 {project?.name}，项目里的记忆库和交接文件都会保留。</p><div className="modal-actions"><button className="outline" disabled={busy} onClick={() => setDialog(null)}>取消</button><button className="outline danger" disabled={busy} onClick={() => void action(async () => { await invoke("forget_project", { root }); setDialog(null); setVersion(v => v + 1); })}>确认移出</button></div></> : <>
        <label className="memory-field">{dialog === "connect" ? "接入的工具" : "记录来源"}<select value={tool} onChange={e => setTool(e.target.value)}>{TOOLS.filter(t => t.memory).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}<option value="user">手工记录</option></select></label>
        {dialog === "handoff" ? <><label className="memory-field">本次摘要<textarea aria-label="本次摘要" maxLength={2000} value={summary} onChange={e => setSummary(e.target.value)} placeholder="本次完成了什么，当前状态怎样" /></label><div className="memory-two-cols"><label className="memory-field">已完成（每行一项）<textarea aria-label="已完成清单" value={done} onChange={e => setDone(e.target.value)} /></label><label className="memory-field">下一步（每行一项）<textarea aria-label="下一步清单" value={next} onChange={e => setNext(e.target.value)} /></label></div></> : dialog === "decision" ? <><label className="memory-field">决策标题<input aria-label="决策标题" maxLength={500} value={title} onChange={e => setTitle(e.target.value)} /></label><label className="memory-field">选择的理由<textarea aria-label="决策理由" maxLength={2000} value={rationale} onChange={e => setRationale(e.target.value)} /></label><label className="memory-field">取代旧决策（可选）<select aria-label="取代旧决策" value={supersedes} onChange={e => setSupersedes(e.target.value)}><option value="">新增独立决策</option>{memory?.decisions.filter(d => d.status === "active").map(d => <option key={d.id} value={d.id}>D{d.id} · {d.title}</option>)}</select></label></> : <>
          <p className="muted">把下面的 stdio 配置加入对应工具的 MCP 设置。它固定到当前项目，复用 TokenLens 可执行文件，无需 Python 或 API key。Codex 使用 TOML，其余提供通用 JSON，按对应工具支持的格式接入。此处不会修改工具配置。</p><textarea className="config-text" aria-label="MCP 配置" readOnly value={config} /><button className="outline" disabled={!config} onClick={() => void copy(config)}>复制 MCP 配置</button>
          <div className="guidance-box"><label><input type="checkbox" checked={guidance} onChange={e => setGuidance(e.target.checked)} />允许更新本项目 AGENTS.md 的 Baton 标记块</label><p>保留标记块以外的内容。无需 MCP 的工具可以读取 .memory/handoff.md；生成指引后请核对文件。</p><button className="outline" disabled={!guidance || busy} onClick={() => void action(async () => { await invoke("rebuild_memory", { root, enableGuidance: true }); setVersion(v => v + 1); setMessage("接入指引已生成，原有 AGENTS.md 内容保留。"); })}>生成接入指引</button></div>
        </>}
        {dialog !== "connect" && <><p className="muted">只写提炼后的进度与决策，请勿粘贴密钥、提示词或完整回答。每项清单最多 500 字，最多 50 项。</p><div className="modal-actions"><button className="outline" disabled={busy} onClick={() => setDialog(null)}>取消</button><button className="outline primary" disabled={busy || (dialog === "handoff" ? !summary.trim() : !title.trim() || !rationale.trim())} onClick={() => void saveRecord()}>{busy ? "正在保存…" : "保存记录"}</button></div></>}
      </>}
    </section></div>}
  </div>;
}
