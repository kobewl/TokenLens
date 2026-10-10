import { useEffect, useRef, useState } from "react";
import { Copy, FolderPlus, GitBranchPlus, Link2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { call, isDesktop, messageOf } from "../lib/api";
import { TOOLS, findTool } from "../lib/catalog";
import { dateTime, relative } from "../lib/format";
import type { Project, ProjectMemory as Memory } from "../lib/types";
import Modal from "../ui/Modal";
import PageHeader from "../ui/PageHeader";
import ToolMark from "../ui/ToolMark";
import { useToast } from "../ui/Toast";

type Dialog = "handoff" | "decision" | "connect" | "forget" | null;
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const toolLabel = (id: string) => (id === "user" ? "手工记录" : (findTool(id)?.name ?? id));

type Props = {
  revision: number;
  root: string;
  setRoot: (root: string) => void;
  onProjectsChanged: () => void;
};

export default function ProjectMemory({ revision, root, setRoot, onProjectsChanged }: Props) {
  const toast = useToast();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [memory, setMemory] = useState<Memory | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
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

  const project = projects?.find((p) => p.root === root) ?? projects?.[0];
  const activeRoot = project?.root ?? "";

  useEffect(() => {
    let alive = true;
    call<Project[]>("list_projects")
      .then((p) => alive && setProjects(p))
      .catch((e) => {
        if (alive) {
          setProjects([]);
          toast("error", messageOf(e));
        }
      });
    return () => void (alive = false);
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = ++generation.current;
    setMemory(null);
    if (!activeRoot) return setLoading(false);
    setLoading(true);
    const timer = setTimeout(() => {
      call<Memory>("project_memory", { root: activeRoot, query })
        .then((m) => id === generation.current && setMemory(m))
        .catch((e) => id === generation.current && toast("error", messageOf(e)))
        .finally(() => id === generation.current && setLoading(false));
    }, 120);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [activeRoot, query, version, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setConfig("");
    if (!activeRoot || dialog !== "connect") return;
    let alive = true;
    call<string>("memory_config", { root: activeRoot, tool })
      .then((c) => alive && setConfig(c))
      .catch((e) => alive && toast("error", messageOf(e)));
    return () => void (alive = false);
  }, [activeRoot, tool, dialog, version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await run();
    } catch (e) {
      toast("error", messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  const bump = () => {
    setVersion((v) => v + 1);
    onProjectsChanged();
  };
  const addProject = () =>
    act(async () => {
      const p = await call<Project | null>("add_project");
      if (p) {
        setRoot(p.root);
        bump();
        toast("success", `已添加项目 ${p.name}`);
      }
    });
  function open(kind: Exclude<Dialog, null>) {
    setSummary("");
    setDone("");
    setNext("");
    setTitle("");
    setRationale("");
    setSupersedes("");
    setGuidance(false);
    setDialog(kind);
  }
  const save = () =>
    act(async () => {
      const handoff = dialog === "handoff";
      const result = await call<{ id: number; warning: string | null }>(handoff ? "write_handoff" : "write_decision", {
        root: activeRoot,
        input: handoff ? { tool, summary, done: lines(done), next: lines(next) } : { tool, title, rationale, supersedes: supersedes ? Number(supersedes) : null },
      });
      toast(result.warning ? "info" : "success", result.warning ? `记录已保存。视图更新告警：${result.warning}` : "记录已保存，交接简报已更新");
      setDialog(null);
      setQuery("");
      bump();
    });
  async function copy(value: string, text = "已复制") {
    try {
      await navigator.clipboard.writeText(value);
      toast("success", text);
    } catch {
      toast("error", "复制失败，请在文本框中选择并复制内容");
    }
  }

  const canSave = dialog === "handoff" ? summary.trim() : title.trim() && rationale.trim();
  const dialogTitle = { handoff: "写交接", decision: "记决策", connect: "接入工具", forget: "移出项目" };

  return (
    <div className="page">
      <PageHeader
        title="项目交接"
        subtitle="记录已完成、下一步和决策理由，让切换工具也能接着工作"
        actions={
          <button className="btn primary" disabled={busy} onClick={() => void addProject()}>
            <FolderPlus size={15} />
            添加项目
          </button>
        }
      />
      {!isDesktop && <div className="banner info">演示数据 · 写入类操作与项目目录选择仅在桌面应用中可用。</div>}

      <div className="split">
        <aside className="card project-list">
          <h3>
            我的项目 <small>{projects?.length ?? 0}</small>
          </h3>
          {projects?.map((p) => (
            <button
              key={p.root}
              className={p.root === activeRoot ? "active" : ""}
              onClick={() => {
                setRoot(p.root);
                setQuery("");
              }}
            >
              <strong>{p.name}</strong>
              <span title={p.root}>{p.root}</span>
            </button>
          ))}
          {projects?.length === 0 && <p className="muted">添加项目目录后，在这里查看共享记忆。</p>}
        </aside>

        <div className="workspace">
          {projects === null ? (
            <div className="skeleton" style={{ height: 200 }} />
          ) : !project ? (
            <div className="card empty">
              <div className="empty-icon">
                <FolderPlus size={20} />
              </div>
              <strong>先选一个项目，开始接棒</strong>
              <p>添加目录只登记项目；首次写入才会在项目里创建记忆库。本机编辑器的原始记忆可在「编辑器记忆」中独立查看。</p>
              <button className="btn primary" disabled={busy} onClick={() => void addProject()}>
                添加项目
              </button>
            </div>
          ) : (
            <>
              <div className="project-heading">
                <div>
                  <h2>{project.name}</h2>
                  <p title={project.root} className="mono">
                    {project.root}
                  </p>
                </div>
                <button className="btn" disabled={busy} onClick={() => open("connect")}>
                  <Link2 size={14} />
                  接入工具
                </button>
                <button className="btn ghost icon" aria-label="移出项目列表" title="移出项目列表" disabled={busy} onClick={() => open("forget")}>
                  <Trash2 size={15} />
                </button>
              </div>

              <div className="memory-actions">
                <button className="btn primary" disabled={busy} onClick={() => open("handoff")}>
                  <Plus size={14} />
                  写交接
                </button>
                <button className="btn" disabled={busy} onClick={() => open("decision")}>
                  <GitBranchPlus size={14} />
                  记决策
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await call("rebuild_memory", { root: activeRoot, enableGuidance: false });
                      bump();
                      toast("success", "交接视图已重建");
                    })
                  }
                >
                  <RefreshCw size={14} />
                  重建简报
                </button>
                <label className="input-icon grow">
                  <Search size={15} />
                  <input className="input" aria-label="搜索项目记忆" maxLength={200} placeholder="搜索摘要或决策，例如：登录" value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
              </div>

              {loading && !memory ? (
                <div className="skeleton" style={{ height: 240 }} />
              ) : (
                memory && (
                  <>
                    {!query && (
                      <section className="card brief">
                        <div className="card-head">
                          <div>
                            <h3>当前交接简报</h3>
                            <p className="sub">
                              {memory.eventCount} 条交接 · {memory.decisionCount} 条决策 · 由明确记录生成
                            </p>
                          </div>
                          <button className="btn sm" onClick={() => void copy(memory.brief, "交接简报已复制，粘贴给任意工具即可接着工作")}>
                            <Copy size={14} />
                            复制简报
                          </button>
                        </div>
                        <div className="card-body">
                          <textarea aria-label="交接简报" readOnly value={memory.brief} />
                        </div>
                      </section>
                    )}

                    <section>
                      <h3 className="section-title">
                        {query ? "匹配的交接" : "交接历史"} <small>最近 {memory.events.length} 条</small>
                      </h3>
                      <div className="timeline">
                        {memory.events.map((e) => (
                          <article className="record" key={e.id}>
                            <header>
                              <ToolMark id={e.tool} size={22} />
                              <span>
                                #{e.id} · {toolLabel(e.tool)}
                              </span>
                              <time title={dateTime(e.ts)}>{relative(e.ts)}</time>
                            </header>
                            <p>{e.summary}</p>
                            {e.done.length > 0 && (
                              <details>
                                <summary>已完成 {e.done.length} 项</summary>
                                <ul>
                                  {e.done.map((d, i) => (
                                    <li key={i}>{d}</li>
                                  ))}
                                </ul>
                              </details>
                            )}
                            {e.next.length > 0 && (
                              <div className="next-box">
                                <strong>下一步</strong>
                                <ul>
                                  {e.next.map((n, i) => (
                                    <li key={i}>{n}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </article>
                        ))}
                        {!memory.events.length && <p className="muted">{query ? "没有匹配的交接摘要。" : "还没有交接，写下本次进度和下一步。"}</p>}
                      </div>
                    </section>

                    <section>
                      <h3 className="section-title">{query ? "匹配的决策" : "决策与演化"}</h3>
                      <div className="timeline">
                        {memory.decisions.map((d) => (
                          <article className={`record decision ${d.status}`} key={d.id}>
                            <header>
                              <span className="badge accent">D{d.id}</span>
                              <span>{toolLabel(d.tool)}</span>
                              <span className={`badge ${d.status === "active" ? "good" : ""}`}>{d.status === "active" ? "有效" : `已被 D${d.supersededBy} 取代`}</span>
                              <time title={dateTime(d.ts)}>{relative(d.ts)}</time>
                            </header>
                            <h4>{d.title}</h4>
                            <p>{d.rationale}</p>
                          </article>
                        ))}
                        {!memory.decisions.length && <p className="muted">{query ? "没有匹配的决策。" : "记下选择与理由，后续取代旧决策时保留完整历史。"}</p>}
                      </div>
                    </section>
                  </>
                )
              )}
            </>
          )}
        </div>
      </div>

      {dialog && (
        <Modal title={dialogTitle[dialog]} onClose={() => setDialog(null)} busy={busy} width={dialog === "connect" ? 680 : 640}>
          {dialog === "forget" ? (
            <>
              <p>只从管理列表移除 <b>{project?.name}</b>，项目里的记忆库和交接文件都会保留。</p>
              <div className="modal-actions">
                <button className="btn" disabled={busy} onClick={() => setDialog(null)}>
                  取消
                </button>
                <button
                  className="btn danger solid"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await call("forget_project", { root: activeRoot });
                      setDialog(null);
                      bump();
                      toast("success", "已移出项目列表");
                    })
                  }
                >
                  确认移出
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="field">
                {dialog === "connect" ? "接入的工具" : "记录来源"}
                <select value={tool} onChange={(e) => setTool(e.target.value)}>
                  {TOOLS.filter((t) => t.memory).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                  <option value="user">手工记录</option>
                </select>
              </label>
              {dialog === "handoff" ? (
                <>
                  <label className="field">
                    本次摘要
                    <textarea className="textarea" aria-label="本次摘要" maxLength={2000} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="本次完成了什么，当前状态怎样" autoFocus />
                  </label>
                  <div className="two-cols">
                    <label className="field">
                      已完成（每行一项）
                      <textarea className="textarea" aria-label="已完成清单" value={done} onChange={(e) => setDone(e.target.value)} />
                    </label>
                    <label className="field">
                      下一步（每行一项）
                      <textarea className="textarea" aria-label="下一步清单" value={next} onChange={(e) => setNext(e.target.value)} />
                    </label>
                  </div>
                </>
              ) : dialog === "decision" ? (
                <>
                  <label className="field">
                    决策标题
                    <input className="input" aria-label="决策标题" maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
                  </label>
                  <label className="field">
                    选择的理由
                    <textarea className="textarea" aria-label="决策理由" maxLength={2000} value={rationale} onChange={(e) => setRationale(e.target.value)} />
                  </label>
                  <label className="field">
                    取代旧决策（可选）
                    <select aria-label="取代旧决策" value={supersedes} onChange={(e) => setSupersedes(e.target.value)}>
                      <option value="">新增独立决策</option>
                      {memory?.decisions
                        .filter((d) => d.status === "active")
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            D{d.id} · {d.title}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <p className="muted">把下面的 stdio 配置加入对应工具的 MCP 设置。它固定到当前项目，复用 TokenLens 可执行文件，无需 Python 或 API key。Codex 使用 TOML，其余提供通用 JSON，按对应工具支持的格式接入。此处不会修改工具配置，接入后请在工具里验证 tools/list。</p>
                  <textarea className="textarea config-text" aria-label="MCP 配置" readOnly value={config} />
                  <button className="btn" disabled={!config} onClick={() => void copy(config, "MCP 配置已复制")}>
                    <Copy size={14} />
                    复制 MCP 配置
                  </button>
                  <div className="guidance-box">
                    <label>
                      <input type="checkbox" checked={guidance} onChange={(e) => setGuidance(e.target.checked)} />
                      允许更新本项目 AGENTS.md 的 Baton 标记块
                    </label>
                    <p>保留标记块以外的内容。无需 MCP 的工具可以读取 .memory/handoff.md；生成指引后请核对文件。</p>
                    <button
                      className="btn"
                      disabled={!guidance || busy}
                      onClick={() =>
                        void act(async () => {
                          await call("rebuild_memory", { root: activeRoot, enableGuidance: true });
                          bump();
                          toast("success", "接入指引已生成，原有 AGENTS.md 内容保留");
                        })
                      }
                    >
                      生成接入指引
                    </button>
                  </div>
                </>
              )}
              {dialog !== "connect" && (
                <>
                  <p className="muted">只写提炼后的进度与决策，请勿粘贴密钥、提示词或完整回答。每项清单最多 500 字，最多 50 项。</p>
                  <div className="modal-actions">
                    <button className="btn" disabled={busy} onClick={() => setDialog(null)}>
                      取消
                    </button>
                    <button className="btn primary" disabled={busy || !canSave} onClick={() => void save()}>
                      {busy ? "正在保存…" : "保存记录"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
