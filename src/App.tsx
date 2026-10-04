import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import "./App.css";

type NamedTotal = {
  name: string;
  totalTokens: number;
  freshInput: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
};
type RequestLog = {
  timestampMs: number;
  app: string;
  provider: string;
  model: string;
  freshInput: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
};
type Overview = {
  range: string;
  rangeStartMs: number;
  rangeEndMs: number;
  undatedCount: number;
  totalTokens: number;
  freshInput: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  eventCount: number;
  byModel: NamedTotal[];
  byApp: NamedTotal[];
  byProject: NamedTotal[];
  byProvider: NamedTotal[];
  series: {
    bucket: string;
    model: string;
    totalTokens: number;
    eventCount: number;
  }[];
  bucketKind: string;
  requests: RequestLog[];
  providers: string[];
  models: string[];
};
type SourceReport = {
  app: string;
  events: number;
  detail: string;
  coverage: string;
};
const APPS = [
  { id: "claude-code", name: "Claude Code", symbol: "✳", color: "#d78565" },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    symbol: "✳",
    color: "#d78565",
  },
  { id: "codex", name: "Codex", symbol: "◎", color: "#555a60" },
  { id: "gemini-cli", name: "Gemini CLI", symbol: "✦", color: "#6d86db" },
  { id: "cursor", name: "Cursor", symbol: "⬡", color: "#555a60" },
  { id: "zcode", name: "ZCode", symbol: "Z", color: "#6496c7" },
  { id: "kiro", name: "Kiro", symbol: "◈", color: "#9978c6" },
  { id: "opencode", name: "OpenCode", symbol: "▣", color: "#555a60" },
];
const NAMES: Record<string, string> = Object.fromEntries(
  APPS.map((a) => [a.id, a.name]),
);
Object.assign(NAMES, {
  chatgpt: "ChatGPT",
  windsurf: "Windsurf",
  trae: "Trae",
  "vscode-copilot": "VS Code Copilot",
  antigravity: "Antigravity",
});
const COVERAGE: Record<string, string> = {
  counted: "已采集",
  partial: "部分采集",
  missing: "未发现记录",
  unavailable: "尚无法采集",
  error: "读取失败",
};
const RANGES = [
  { id: "today", label: "当天" },
  { id: "7d", label: "近 7 天" },
  { id: "30d", label: "近 30 天" },
  { id: "all", label: "全部时间" },
];
const number = (n: number) => new Intl.NumberFormat("zh-CN").format(n);
const compact = (n: number) =>
  n >= 1e8
    ? `${(n / 1e8).toFixed(2)}亿`
    : n >= 1e4
      ? `${(n / 1e4).toFixed(2)}万`
      : number(n);
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    chart: (
      <>
        <path d="M4 3v17h17M8 16v-5m5 5V6m5 10V9" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" />
      </>
    ),
    settings: (
      <>
        <path d="m9 3-1 3-3 1-2 3 2 2-1 4 3 2 3-1 2 3 4-1 1-3 3-1 1-4-3-2V5l-4-2-2 2z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    chevron: <path d="m8 4 8 8-8 8" />,
    back: <path d="m15 5-7 7 7 7" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5.5-1.5 1-1.5 2m0 3h.01" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.chart}
    </svg>
  );
}
function AppMark({ id }: { id: string }) {
  const a = APPS.find((a) => a.id === id);
  return (
    <span
      className={`app-mark ${id}`}
      style={{ color: a?.color }}
      aria-hidden="true"
    >
      {a?.symbol ?? "◉"}
    </span>
  );
}
export default function App() {
  const [range, setRange] = useState("today");
  const [app, setApp] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadedSelection, setLoadedSelection] = useState("");
  const selection = JSON.stringify([range, app, provider, model]);
  const [sources, setSources] = useState<SourceReport[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [synced, setSynced] = useState<Date | null>(null);
  const [auto, setAuto] = useState(() => {
    const saved = localStorage.getItem("tokenlens-auto-refresh");
    return saved !== null && [0, 30, 60].includes(Number(saved)) ? Number(saved) : 30;
  });
  const [metric, setMetric] = useState<"requests" | "tokens">("requests");
  const [tab, setTab] = useState("requests");
  const [more, setMore] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [dialog, setDialog] = useState<"sources" | "settings" | null>(null);
  const [page, setPage] = useState(0);
  const [theme, setTheme] = useState(
    () => {
      const saved = localStorage.getItem("tokenlens-theme");
      return saved && ["light", "dark", "system"].includes(saved) ? saved : "light";
    },
  );
  const [dataBusy, setDataBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const refreshLock = useRef(false);
  const desktop = isTauri();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("tokenlens-theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("tokenlens-auto-refresh", String(auto));
  }, [auto]);
  useEffect(() => { setConfirmClear(false); }, [dialog]);
  const refresh = useCallback(async () => {
    if (!desktop || refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    try {
      setSources(await invoke<SourceReport[]>("refresh"));
      setSynced(new Date());
      setRevision((v) => v + 1);
      setError("");
    } catch (e) {
      setError(`同步失败：${String(e)}`);
    } finally {
      refreshLock.current = false;
      setRefreshing(false);
    }
  }, [desktop]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!auto || !desktop) return;
    const timer = window.setInterval(() => void refresh(), auto * 1000);
    return () => clearInterval(timer);
  }, [auto, desktop, refresh]);
  useEffect(() => {
    if (!desktop) return;
    const id = ++generation.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void invoke<Overview>("overview", { range, app, provider, model })
        .then((data) => {
          if (id === generation.current) {
            setOverview(data);
            setLoadedSelection(JSON.stringify([range, app, provider, model]));
            setPage((p) =>
              Math.min(
                p,
                Math.max(0, Math.ceil(data.requests.length / 10) - 1),
              ),
            );
            setError("");
          }
        })
        .catch((e) => {
          if (id === generation.current) {
            setOverview(null);
            setError(`读取失败：${String(e)}`);
          }
        })
        .finally(() => {
          if (id === generation.current) setLoading(false);
        });
    }, 80);
    return () => {
      window.clearTimeout(timer);
      generation.current += 1;
    };
  }, [desktop, range, app, provider, model, revision]);
  useEffect(() => {
    setPage(0);
  }, [range, app, provider, model]);
  useEffect(() => {
    if (!dialog) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDialog(null);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [dialog]);
  async function exportUsage() {
    if (!desktop || dataBusy) return;
    setDataBusy(true);
    setNotice("");
    try {
      const path = await invoke<string | null>("export_usage", { range, app, provider, model });
      if (path) setNotice(`用量元数据已保存：${path}`);
    } catch (e) { setError(`导出失败：${String(e)}`); }
    finally { setDataBusy(false); }
  }
  async function clearUsage() {
    if (!desktop || dataBusy || refreshLock.current) return;
    setDataBusy(true);
    refreshLock.current = true;
    setAuto(0);
    setNotice("");
    try {
      await invoke("clear_usage");
      setSources([]);
      setOverview(null);
      setSynced(null);
      setConfirmClear(false);
      setRevision((v) => v + 1);
      setNotice("本地用量已清空，自动刷新已关闭。再次同步会重新读取来源记录。");
    } catch (e) { setError(`清空失败：${String(e)}`); }
    finally { setDataBusy(false); refreshLock.current = false; }
  }
  function selectApp(id: string) {
    setApp(id);
    setProvider("");
    setModel("");
  }
  const cacheInput =
    (overview?.freshInput ?? 0) +
    (overview?.cacheReadTokens ?? 0) +
    (overview?.cacheWriteTokens ?? 0);
  const cacheRate =
    overview && cacheInput > 0
      ? `${((overview.cacheReadTokens / cacheInput) * 100).toFixed(1)}%`
      : "—";
  const rows =
    tab === "providers"
      ? overview?.byProvider
      : tab === "models"
        ? overview?.byModel
        : overview?.byProject;
  const rangeLabel = RANGES.find((r) => r.id === range)?.label;
  const totalPages = Math.ceil((overview?.requests.length ?? 0) / 10);
  const hasData =
    loadedSelection === selection && (overview?.eventCount ?? 0) > 0;
  const matchesSelection = loadedSelection === selection;
  const undatedCount = matchesSelection ? (overview?.undatedCount ?? 0) : 0;
  const showUndated = undatedCount > 0 && range !== "all";
  const dateLabel = (time: number) =>
    new Date(time).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  const hasInput = (overview?.freshInput ?? 0) > 0;
  const hasOutput = (overview?.outputTokens ?? 0) > 0;
  const hasCacheRead = (overview?.cacheReadTokens ?? 0) > 0;
  const hasCacheWrite = (overview?.cacheWriteTokens ?? 0) > 0;
  const visibleApps = APPS.filter(
    (a) =>
      a.id === app ||
      sources.some((source) => source.app === a.id && source.events > 0) ||
      overview?.byApp.some(
        (row) =>
          row.totalTokens > 0 && (row.name === a.name || row.name === a.id),
      ),
  );

  return (
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">◈</span>
          {!collapsed && <strong>TokenLens</strong>}
          <button
            className="collapse-button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "展开导航" : "收起导航"}
          >
            <Icon name={collapsed ? "chevron" : "back"} size={16} />
          </button>
        </div>
        <nav className="app-nav" aria-label="应用筛选">
          {visibleApps.map((a) => (
            <button
              key={a.id}
              className={app === a.id ? "selected" : ""}
              onClick={() => selectApp(app === a.id ? "" : a.id)}
              title={a.name}
              aria-pressed={app === a.id}
            >
              <AppMark id={a.id} />
              {!collapsed && <span>{a.name}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="selected"
            onClick={() => selectApp("")}
            title="用量统计"
          >
            <Icon name="chart" />
            {!collapsed && (
              <>
                <span>用量统计</span>
                {hasData && <small>{compact(overview!.totalTokens)}</small>}
              </>
            )}
          </button>
          <button onClick={() => setDialog("sources")} title="数据来源">
            <Icon name="database" />
            {!collapsed && <span>数据来源</span>}
          </button>
          <button onClick={() => setDialog("settings")} title="设置">
            <Icon name="settings" />
            {!collapsed && <span>设置</span>}
          </button>
          <div className="local-note">
            {collapsed ? "本机" : "本机记录 · 隐私优先"}
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <h1>
            <Icon name="chart" size={24} />
            用量统计{" "}
            <span title="统计来自本机可读取的用量记录，可能与供应商账单不同。">
              <Icon name="help" size={16} />
            </span>
          </h1>
          <div className="header-tools">
            <span className="sync-status" role="status">
              {refreshing
                ? "正在同步…"
                : synced
                  ? `会话日志 · ${synced.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 同步`
                  : "会话日志 · 等待同步"}
            </span>
            <button
              className="outline"
              onClick={() => void refresh()}
              disabled={refreshing || dataBusy || !desktop}
            >
              <span className={refreshing ? "spin" : ""}>
                <Icon name="refresh" size={18} />
              </span>
              立即同步
            </button>
            <select
              aria-label="自动刷新"
              value={auto}
              onChange={(e) => setAuto(Number(e.target.value))}
            >
              <option value={0}>关闭自动刷新</option>
              <option value={30}>自动刷新 30 秒</option>
              <option value={60}>自动刷新 60 秒</option>
            </select>
            <button className="outline" onClick={() => void exportUsage()} disabled={!desktop || dataBusy || loading || !hasData}>
              {dataBusy ? "处理中…" : "导出元数据"}
            </button>
            <button
              className="source-button"
              onClick={() => setDialog("sources")}
            >
              <Icon name="database" size={18} />
              数据来源
            </button>
          </div>
        </header>
        <div className="content" aria-busy={loading}>
          {!desktop && (
            <p className="notice">
              浏览器预览 · 在 TokenLens 桌面应用中查看本机真实用量。
            </p>
          )}
          {notice && <p className="notice" role="status">{notice}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="filters">
            <div className="app-filter" role="group" aria-label="选择应用">
              <button
                className={!app ? "active" : ""}
                onClick={() => selectApp("")}
                aria-pressed={!app}
              >
                全部
              </button>
              {visibleApps.map((a) => (
                <button
                  key={a.id}
                  className={app === a.id ? "active" : ""}
                  title={a.name}
                  aria-label={a.name}
                  aria-pressed={app === a.id}
                  onClick={() => selectApp(app === a.id ? "" : a.id)}
                >
                  <AppMark id={a.id} />
                </button>
              ))}
            </div>
            <div className="select-filters">
              <select
                aria-label="供应商筛选"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                <option value="">供应商</option>
                {overview?.providers.map((p) => (
                  <option key={p} value={p}>
                    {p || "未知供应商"}
                  </option>
                ))}
              </select>
              <select
                aria-label="模型筛选"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                <option value="">模型</option>
                {overview?.models.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <select
                aria-label="时间范围"
                value={range}
                onChange={(e) => setRange(e.target.value)}
              >
                {RANGES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {matchesSelection && overview && range !== "all" && (
            <p className="range-note">
              统计范围：{dateLabel(overview.rangeStartMs)} —{" "}
              {dateLabel(overview.rangeEndMs)}
              {range === "30d" && "（最近 30 个自然日，含今天）"}
            </p>
          )}
          {!hasData ? (
            <div className="quiet-empty" role="status">
              <strong>
                {loading || (!overview && refreshing)
                  ? "正在读取用量…"
                  : showUndated
                    ? `${number(undatedCount)} 条用量记录缺少调用日期`
                    : "当前范围内暂无用量"}
              </strong>
              {!loading && (
                <p>
                  {showUndated
                    ? `无法确定这些记录是否属于「${rangeLabel}」。`
                    : desktop
                      ? "试试切换应用或时间范围。"
                      : "在桌面应用中同步后查看本机用量。"}
                </p>
              )}
              {showUndated && (
                <button
                  className="undated-link"
                  onClick={() => setRange("all")}
                >
                  查看全部记录
                </button>
              )}
            </div>
          ) : (
            <>
              {undatedCount > 0 && (
                <p className="range-note">
                  {range === "all"
                    ? `含 ${number(undatedCount)} 条日期未知记录，未分配到具体日期。`
                    : `另有 ${number(undatedCount)} 条记录缺少日期，未计入当前时间范围。`}
                  {range !== "all" && (
                    <button
                      className="undated-link"
                      onClick={() => setRange("all")}
                    >
                      查看全部记录
                    </button>
                  )}
                </p>
              )}
              <p className="unit-note">
                数量单位：万＝10,000 · 亿＝100,000,000（1 亿＝10,000 万）
              </p>
              <section className="summary" aria-label="用量概览">
                <Metric
                  label="总请求数"
                  value={overview ? number(overview.eventCount) : "—"}
                />
                <Metric
                  label="真实消耗 Tokens"
                  value={overview ? compact(overview.totalTokens) : "—"}
                  exact={
                    overview
                      ? `${number(overview.totalTokens)} Tokens`
                      : undefined
                  }
                  help="包含新输入、输出及缓存 Token；推理 Token 包含在输出中。"
                />
                {hasCacheRead && (
                  <Metric
                    label="缓存命中率"
                    value={cacheRate}
                    help="缓存读取 Token /（新输入 + 缓存读取 + 缓存写入 Token）。"
                  />
                )}
                <button
                  className="more-button"
                  onClick={() => setMore(!more)}
                  aria-expanded={more}
                >
                  更多指标 <span className={more ? "up" : ""}>⌄</span>
                </button>
              </section>
              {more && (
                <section className="extra-metrics">
                  {[
                    { key: "freshInput" as const, name: "新增输入" },
                    { key: "outputTokens" as const, name: "输出" },
                    { key: "cacheReadTokens" as const, name: "缓存读取" },
                    { key: "cacheWriteTokens" as const, name: "缓存写入" },
                    {
                      key: "reasoningTokens" as const,
                      name: "推理（含在输出中）",
                    },
                  ]
                    .filter((p) => (overview?.[p.key] ?? 0) > 0)
                    .map((p) => (
                      <Metric
                        key={p.key}
                        label={p.name}
                        value={overview ? compact(overview[p.key]) : "—"}
                        exact={
                          overview
                            ? `${number(overview[p.key])} Tokens`
                            : undefined
                        }
                      />
                    ))}
                </section>
              )}
              <section className="chart-panel">
                <div className="panel-head">
                  <div>
                    使用趋势 · {rangeLabel}
                    <span className="chart-key">
                      <i />
                      {metric === "requests" ? "请求数" : "Tokens"}
                    </span>
                  </div>
                  <div className="segments" role="group" aria-label="趋势指标">
                    <button
                      className={metric === "requests" ? "active" : ""}
                      onClick={() => setMetric("requests")}
                    >
                      请求
                    </button>
                    <button
                      className={metric === "tokens" ? "active" : ""}
                      onClick={() => setMetric("tokens")}
                    >
                      Tokens
                    </button>
                  </div>
                </div>
                <BarChart overview={overview} metric={metric} range={range} />
              </section>
              <section className="details">
                <div className="detail-head">
                  <div className="tabs" role="tablist" aria-label="用量明细">
                    {[
                      { id: "requests", label: "请求日志" },
                      { id: "providers", label: "供应商" },
                      { id: "models", label: "模型" },
                      { id: "projects", label: "项目" },
                    ].map((t) => (
                      <button
                        key={t.id}
                        role="tab"
                        aria-selected={tab === t.id}
                        className={tab === t.id ? "active" : ""}
                        onClick={() => setTab(t.id)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <span className="detail-note">
                    {tab === "requests"
                      ? "仅显示用量元数据"
                      : "按 Token 用量排序"}
                  </span>
                </div>
                <div
                  className="table-scroll"
                  role="tabpanel"
                  aria-label={tab === "requests" ? "请求日志" : "用量汇总"}
                >
                  {tab === "requests" ? (
                    <table>
                      <thead>
                        <tr>
                          {[
                            "时间",
                            "应用",
                            "供应商",
                            "模型",
                            ...(hasInput ? ["新增输入"] : []),
                            ...(hasOutput ? ["输出"] : []),
                            ...(hasCacheRead ? ["缓存命中"] : []),
                          ].map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {overview?.requests
                          .slice(page * 10, page * 10 + 10)
                          .map((r, i) => (
                            <tr key={`${r.timestampMs}-${page}-${i}`}>
                              <td className="time">
                                {r.timestampMs > 0
                                  ? new Date(r.timestampMs).toLocaleString(
                                      "zh-CN",
                                      range === "today"
                                        ? {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                            second: "2-digit",
                                            hour12: false,
                                          }
                                        : {
                                            month: "2-digit",
                                            day: "2-digit",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                            hour12: false,
                                          },
                                    )
                                  : "日期未知"}
                              </td>
                              <td>
                                <span className="table-app">
                                  <AppMark id={r.app} />
                                  {NAMES[r.app] ?? r.app}
                                </span>
                              </td>
                              <td>{r.provider || "未知"}</td>
                              <td className="model-name" title={r.model}>
                                {r.model}
                              </td>
                              {hasInput && <td>{number(r.freshInput)}</td>}
                              {hasOutput && <td>{number(r.outputTokens)}</td>}
                              {hasCacheRead && (
                                <td title={number(r.cacheReadTokens)}>
                                  {compact(r.cacheReadTokens)}
                                </td>
                              )}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  ) : (
                    <table className="aggregate-table">
                      <thead>
                        <tr>
                          {[
                            tab === "providers"
                              ? "供应商"
                              : tab === "models"
                                ? "模型"
                                : "项目",
                            "总 Tokens",
                            ...(hasInput ? ["新增输入"] : []),
                            ...(hasOutput ? ["输出"] : []),
                            ...(hasCacheRead ? ["缓存读取"] : []),
                            ...(hasCacheWrite ? ["缓存写入"] : []),
                            "占比",
                          ].map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows?.map((r) => (
                          <tr key={r.name}>
                            <td title={r.name}>{r.name || "未知"}</td>
                            <td>{number(r.totalTokens)}</td>
                            {hasInput && <td>{number(r.freshInput)}</td>}
                            {hasOutput && <td>{number(r.outputTokens)}</td>}
                            {hasCacheRead && (
                              <td>{compact(r.cacheReadTokens)}</td>
                            )}
                            {hasCacheWrite && (
                              <td>{compact(r.cacheWriteTokens)}</td>
                            )}
                            <td>
                              {overview?.totalTokens
                                ? `${((r.totalTokens / overview.totalTokens) * 100).toFixed(1)}%`
                                : "0%"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {!(tab === "requests"
                    ? overview?.requests.length
                    : rows?.length) && (
                    <div className="empty-state">
                      <Icon name="database" size={28} />
                      <strong>
                        {loading || refreshing
                          ? "正在读取用量记录"
                          : "当前范围内暂无记录"}
                      </strong>
                      <p>
                        {desktop
                          ? "切换应用或时间范围，查看已采集的本机用量。"
                          : "请打开桌面应用并同步会话日志。"}
                      </p>
                    </div>
                  )}
                </div>
                {tab === "requests" && (overview?.requests.length ?? 0) > 0 && (
                  <div className="pagination">
                    <span>
                      共 {number(overview?.eventCount ?? 0)} 次请求 · 展示最近{" "}
                      {overview?.requests.length} 条
                    </span>
                    <div>
                      <button
                        aria-label="上一页"
                        disabled={page === 0}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        ‹
                      </button>
                      <span>
                        {page + 1} / {totalPages}
                      </span>
                      <button
                        aria-label="下一页"
                        disabled={page + 1 >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        ›
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
          <footer>
            TokenLens <span>本机统计可能与供应商账单存在差异</span>
          </footer>
        </div>
      </main>
      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={dialog === "sources" ? "数据来源" : "设置"}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>{dialog === "sources" ? "数据来源" : "设置"}</h2>
              <button
                autoFocus
                aria-label="关闭"
                onClick={() => setDialog(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            {dialog === "sources" ? (
              <>
                <p className="muted">只统计能读取到 Token 数的本机记录。</p>
                <div className="source-list">
                  {sources.map((s) => (
                    <article key={s.app}>
                      <div>
                        <strong>{NAMES[s.app] ?? s.app}</strong>
                        <span className={`coverage-status ${s.coverage}`}>
                          {COVERAGE[s.coverage] ?? s.coverage}
                        </span>
                        {s.events > 0 && <small>{number(s.events)} 条</small>}
                      </div>
                      <p>{s.detail}</p>
                    </article>
                  ))}
                  {!sources.length && (
                    <p className="muted">
                      {desktop
                        ? "同步后显示来源覆盖情况。"
                        : "请在桌面应用中同步本机记录。"}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="setting-row">
                  <div>
                    <strong>外观</strong>
                    <p>选择界面的显示主题</p>
                  </div>
                  <select
                    aria-label="外观"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                  >
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                    <option value="system">跟随系统</option>
                  </select>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>自动刷新</strong>
                    <p>定时同步本机会话记录</p>
                  </div>
                  <select
                    aria-label="设置自动刷新"
                    value={auto}
                    onChange={(e) => setAuto(Number(e.target.value))}
                  >
                    <option value={0}>关闭</option>
                    <option value={30}>30 秒</option>
                    <option value={60}>60 秒</option>
                  </select>
                </div>
                <div className="setting-row">
                  <div><strong>本地用量数据</strong><p>仅清空 TokenLens 的统计，保留来源日志和外观设置。</p></div>
                  <button className="outline danger" disabled={!desktop || refreshing || dataBusy} onClick={() => setConfirmClear(true)}>清空用量</button>
                </div>
                {confirmClear && <div className="clear-confirm" role="alert">
                  <strong>确认清空所有已采集用量？</strong>
                  <p>自动刷新将关闭。再次同步会重新导入来源日志中的记录。</p>
                  <div>
                    <button className="outline" disabled={dataBusy} onClick={() => setConfirmClear(false)}>取消</button>
                    <button className="outline danger" disabled={dataBusy || refreshing} onClick={() => void clearUsage()}>{dataBusy ? "正在清空…" : "确认清空"}</button>
                  </div>
                </div>}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  help,
  exact,
}: {
  label: string;
  value: string;
  help?: string;
  exact?: string;
}) {
  return (
    <article className="metric">
      <div>
        {label}
        {help && (
          <span title={help}>
            <Icon name="help" size={15} />
          </span>
        )}
      </div>
      <strong title={exact ?? value}>{value}</strong>
      {exact && <p className="metric-exact">{exact}</p>}
    </article>
  );
}
function BarChart({
  overview,
  metric,
  range,
}: {
  overview: Overview | null;
  metric: "requests" | "tokens";
  range: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(() => {
    const values = new Map<string, number>();
    for (const p of overview?.series ?? [])
      values.set(
        p.bucket,
        (values.get(p.bucket) ?? 0) +
          (metric === "requests" ? p.eventCount : p.totalTokens),
      );
    if (range === "today")
      for (let h = 0; h < 24; h++) {
        const key = `${String(h).padStart(2, "0")}:00`;
        if (!values.has(key)) values.set(key, 0);
      }
    if (range === "7d" || range === "30d")
      for (let i = range === "7d" ? 6 : 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        if (!values.has(key)) values.set(key, 0);
      }
    return [...values].sort(([a], [b]) => a.localeCompare(b));
  }, [overview, metric, range]);
  useEffect(() => setHover(null), [points]);
  const width = 1000,
    height = 208,
    left = 58,
    right = 16,
    top = 16,
    bottom = 36;
  const rawMax = Math.max(
    metric === "requests" ? 2 : 1,
    ...points.map((p) => p[1]),
  );
  const order = 10 ** Math.floor(Math.log10(rawMax));
  const max = Math.ceil(rawMax / order) * order;
  const innerW = width - left - right,
    innerH = height - top - bottom;
  const step = innerW / Math.max(points.length, 1),
    barWidth = Math.max(1, Math.min(38, step * 0.76));
  const labelStep = Math.max(1, Math.ceil(points.length / 8));
  const active = hover === null ? null : points[hover];
  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${metric === "requests" ? "请求数" : "Token"}使用趋势柱状图`}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              className="grid-line"
              x1={left}
              x2={width - right}
              y1={top + innerH * t}
              y2={top + innerH * t}
            />
            <text
              className="axis"
              x={left - 12}
              y={top + innerH * t + 5}
              textAnchor="end"
            >
              {compact(max * (1 - t))}
            </text>
          </g>
        ))}
        {points.map(([bucket, value], i) => (
          <g key={bucket}>
            <rect
              className="chart-hit"
              x={left + step * i}
              y={top}
              width={step}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
            <rect
              className="chart-bar"
              x={left + step * (i + 0.5) - barWidth / 2}
              y={top + innerH * (1 - value / max)}
              width={barWidth}
              height={(innerH * value) / max}
              rx={3}
              style={{ opacity: hover === i ? 0.75 : 1 }}
              onMouseEnter={() => setHover(i)}
            >
              <title>
                {bucket}：{number(value)}
              </title>
            </rect>
            {i % labelStep === 0 && (
              <text
                className="axis"
                x={left + step * (i + 0.5)}
                y={height - 8}
                textAnchor="middle"
              >
                {/^\d{4}-/.test(bucket) ? bucket.slice(5) : bucket}
              </text>
            )}
          </g>
        ))}
      </svg>
      {active && (
        <div
          className="chart-tip"
          style={{
            left: `${Math.min(84, Math.max(12, ((left + step * ((hover ?? 0) + 0.5)) / width) * 100))}%`,
          }}
        >
          <strong>{active[0]}</strong>
          <span>
            {metric === "requests" ? "请求数" : "Tokens"}{" "}
            <b>{number(active[1])}</b>
          </span>
        </div>
      )}
      {!overview?.eventCount && (
        <div className="chart-empty">
          {overview ? "当前范围内暂无用量" : "等待本机用量数据"}
        </div>
      )}
    </div>
  );
}
