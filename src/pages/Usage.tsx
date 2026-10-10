import { useEffect, useMemo, useState } from "react";
import { Database, Download, FilterX } from "lucide-react";
import { call, isDesktop, messageOf } from "../lib/api";
import { CHART_COLORS, findTool, toolId, toolName } from "../lib/catalog";
import { compact, dateTime, number, percent } from "../lib/format";
import { useDaily, useOverview, windowTotal, type Filters, type useSync } from "../lib/hooks";
import { modelCost, money, totalCost, type PriceBook } from "../lib/pricing";
import type { NamedTotal, PageId, Range } from "../lib/types";
import Delta from "../ui/Delta";
import PageHeader from "../ui/PageHeader";
import Stat from "../ui/Stat";
import SyncPill from "../ui/SyncPill";
import ToolMark from "../ui/ToolMark";
import { useToast } from "../ui/Toast";
import TrendChart, { type Metric } from "../charts/TrendChart";

const RANGES: { id: Range; label: string; days: number }[] = [
  { id: "today", label: "当天", days: 1 },
  { id: "7d", label: "近 7 天", days: 7 },
  { id: "30d", label: "近 30 天", days: 30 },
  { id: "all", label: "全部", days: 0 },
];
const TABS = [
  { id: "requests", label: "请求日志" },
  { id: "models", label: "模型" },
  { id: "apps", label: "工具" },
  { id: "providers", label: "供应商" },
  { id: "projects", label: "项目" },
] as const;
type Tab = (typeof TABS)[number]["id"];

type Props = {
  sync: ReturnType<typeof useSync>;
  prices: PriceBook;
  filters: Filters;
  setFilters: (f: Filters) => void;
  navigate: (page: PageId) => void;
};

export default function Usage({ sync, prices, filters, setFilters, navigate }: Props) {
  const toast = useToast();
  const { range, app, provider, model } = filters;
  const { data: o, loading, error, current } = useOverview(filters, sync.revision);
  const rangeMeta = RANGES.find((r) => r.id === range)!;
  const compareDays = rangeMeta.days * 2;
  const daily = useDaily(Math.max(compareDays, 2), { app, provider, model }, sync.revision, rangeMeta.days > 0);
  const [metric, setMetric] = useState<Metric>("tokens");
  const [tab, setTab] = useState<Tab>("requests");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => setPage(0), [filters, pageSize]);
  useEffect(() => {
    if (error) toast("error", `读取失败：${error}`);
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const clean = range !== "today" || app || provider || model;

  const matches = current && o;
  const hasData = !!matches && o.eventCount > 0;
  const undated = matches ? o.undatedCount : 0;
  const previous = useMemo(
    () => (rangeMeta.days ? windowTotal(daily.days, rangeMeta.days, rangeMeta.days) : null),
    [daily.days, rangeMeta.days],
  );
  const cacheInput = (o?.freshInput ?? 0) + (o?.cacheReadTokens ?? 0) + (o?.cacheWriteTokens ?? 0);
  const cost = o ? totalCost(prices, o.byModel) : null;
  const apps = useMemo(() => {
    const ids = new Set<string>();
    sync.sources.filter((s) => s.events > 0).forEach((s) => ids.add(s.app));
    o?.byApp.filter((r) => r.totalTokens > 0).forEach((r) => ids.add(toolId(r.name)));
    if (app) ids.add(app);
    return [...ids];
  }, [sync.sources, o, app]);

  const rows: NamedTotal[] | undefined = { models: o?.byModel, apps: o?.byApp, providers: o?.byProvider, projects: o?.byProject, requests: undefined }[tab];
  const requests = o?.requests ?? [];
  const pages = Math.max(1, Math.ceil(requests.length / pageSize));

  async function exportUsage() {
    setExporting(true);
    try {
      const path = await call<string | null>("export_usage", { range, app, provider, model });
      if (path) toast("success", `用量元数据已保存：${path}`);
    } catch (e) {
      toast("error", `导出失败：${messageOf(e)}`);
    } finally {
      setExporting(false);
    }
  }

  const parts = o
    ? [
        { key: "fresh", name: "新输入", v: o.freshInput, color: CHART_COLORS[0] },
        { key: "out", name: "输出", v: o.outputTokens, color: CHART_COLORS[1] },
        { key: "cr", name: "缓存读取", v: o.cacheReadTokens, color: CHART_COLORS[2] },
        { key: "cw", name: "缓存写入", v: o.cacheWriteTokens, color: CHART_COLORS[3] },
      ].filter((p) => p.v > 0)
    : [];

  const timeFmt: Intl.DateTimeFormatOptions =
    range === "today"
      ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }
      : { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false };
  const showCost = prices && Object.keys(prices.models).length > 0;

  return (
    <div className="page">
      <PageHeader
        title="用量统计"
        subtitle="本机 AI 工具的 Token 用量元数据，不含对话内容"
        actions={
          <>
            <SyncPill refreshing={sync.refreshing} synced={sync.synced} onRefresh={() => void sync.refresh()} />
            <button className="btn" disabled={!hasData || exporting} onClick={() => void exportUsage()} title="导出当前筛选的全部元数据">
              <Download size={14} />
              {exporting ? "导出中…" : "导出"}
            </button>
          </>
        }
      />

      <div className="filter-bar">
        <div className="app-chips" role="group" aria-label="选择工具">
          <button className={!app ? "active" : ""} aria-pressed={!app} onClick={() => set({ app: "", provider: "", model: "" })}>
            全部工具
          </button>
          {apps.map((id) => (
            <button key={id} className={app === id ? "active" : ""} aria-pressed={app === id} onClick={() => set({ app: app === id ? "" : id, provider: "", model: "" })}>
              <ToolMark id={id} size={18} />
              {toolName(id)}
            </button>
          ))}
        </div>
        <div className="filter-right">
          <select aria-label="供应商筛选" value={provider} onChange={(e) => set({ provider: e.target.value })}>
            <option value="">全部供应商</option>
            {o?.providers.map((p) => (
              <option key={p} value={p}>
                {p || "未知供应商"}
              </option>
            ))}
          </select>
          <select aria-label="模型筛选" value={model} onChange={(e) => set({ model: e.target.value })}>
            <option value="">全部模型</option>
            {o?.models.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <div className="seg" role="group" aria-label="时间范围">
            {RANGES.map((r) => (
              <button key={r.id} className={range === r.id ? "active" : ""} onClick={() => set({ range: r.id })}>
                {r.label}
              </button>
            ))}
          </div>
          {clean && (
            <button className="btn ghost sm" onClick={() => setFilters({ range: "today", app: "", provider: "", model: "" })}>
              <FilterX size={14} />
              重置
            </button>
          )}
        </div>
      </div>

      {matches && range !== "all" && (
        <p className="range-note">
          统计范围 {new Date(o.rangeStartMs).toLocaleDateString("zh-CN")} — {new Date(o.rangeEndMs).toLocaleDateString("zh-CN")}
          {range === "30d" && "（最近 30 个自然日，含今天）"}
          {undated > 0 && (
            <>
              ；另有 {number(undated)} 条记录缺少日期，未计入。
              <button className="text-action" onClick={() => set({ range: "all" })}>
                查看全部
              </button>
            </>
          )}
        </p>
      )}
      {matches && range === "all" && undated > 0 && <p className="range-note">含 {number(undated)} 条日期未知的记录，未分配到具体日期。</p>}

      {!hasData ? (
        <div className="card">
          {loading || !matches ? (
            <div className="empty">
              <div className="skeleton" style={{ width: 220, height: 14 }} />
              <div className="skeleton" style={{ width: 160, height: 12 }} />
            </div>
          ) : (
            <div className="empty">
              <div className="empty-icon">
                <Database size={20} />
              </div>
              <strong>{undated > 0 && range !== "all" ? `${number(undated)} 条记录缺少调用日期` : "当前筛选下暂无用量"}</strong>
              <p>
                {undated > 0 && range !== "all"
                  ? `无法确定这些记录是否属于「${rangeMeta.label}」。`
                  : clean
                    ? "试试放宽时间范围或清除筛选。"
                    : "使用任意受支持的 AI 工具后点击「立即同步」，或到「工具」页确认数据来源。"}
              </p>
              <div className="row-actions center">
                {undated > 0 && range !== "all" && (
                  <button className="btn" onClick={() => set({ range: "all" })}>
                    查看全部记录
                  </button>
                )}
                {range !== "all" && (
                  <button className="btn" onClick={() => set({ range: "30d" })}>
                    查看近 30 天
                  </button>
                )}
                <button className="btn" onClick={() => navigate("tools")}>
                  检查数据来源
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <section className="kpis" aria-label="用量概览" aria-busy={loading}>
            <Stat
              label="真实消耗 Tokens"
              value={compact(o.totalTokens)}
              sub={`${number(o.totalTokens)} Tokens`}
              help="包含新输入、输出及缓存 Token；推理 Token 已包含在输出中。"
              footer={previous && daily.loaded ? <Delta current={o.totalTokens} previous={previous.tokens} label={range === "today" ? "较昨日全天" : `较前 ${rangeMeta.days} 天`} /> : undefined}
            />
            <Stat
              label="总请求数"
              value={number(o.eventCount)}
              sub={`平均每次 ${compact(Math.round(o.totalTokens / Math.max(o.eventCount, 1)))} Tokens`}
              footer={previous && daily.loaded ? <Delta current={o.eventCount} previous={previous.events} label={range === "today" ? "较昨日全天" : `较前 ${rangeMeta.days} 天`} /> : undefined}
            />
            {o.cacheReadTokens > 0 && <Stat label="缓存命中率" value={percent(o.cacheReadTokens, cacheInput, 1)} sub={`缓存读取 ${compact(o.cacheReadTokens)} Tokens`} help="缓存读取 /（新输入 + 缓存读取 + 缓存写入）。" />}
            {showCost && cost && cost.priced > 0 && (
              <Stat
                label="估算花费"
                value={money(prices, cost.cost)}
                sub={cost.unpriced ? `另有 ${cost.unpriced} 个模型未定价` : "全部模型均已定价"}
                help="按你在「设置 → 估算定价」填写的价格计算，仅供参考，以供应商账单为准。"
              />
            )}
          </section>

          {parts.length > 1 && (
            <section className="card compose">
              <div className="card-body">
                <div className="compose-bar" role="img" aria-label="Token 构成">
                  {parts.map((p) => (
                    <i key={p.key} style={{ flex: p.v, background: p.color }} title={`${p.name} ${number(p.v)}`} />
                  ))}
                </div>
                <ul className="compose-legend">
                  {parts.map((p) => (
                    <li key={p.key}>
                      <i style={{ background: p.color }} />
                      {p.name}
                      <b className="num">{compact(p.v)}</b>
                      <small className="num">{percent(p.v, o.totalTokens)}</small>
                    </li>
                  ))}
                  {o.reasoningTokens > 0 && (
                    <li className="aside">
                      其中推理 <b className="num">{compact(o.reasoningTokens)}</b>
                      <small>（含在输出中）</small>
                    </li>
                  )}
                </ul>
              </div>
            </section>
          )}

          <section className="card">
            <div className="card-head">
              <div>
                <h3>使用趋势 · {rangeMeta.label}</h3>
                <p className="sub">按模型堆叠，悬停查看明细</p>
              </div>
              <div className="seg" role="group" aria-label="趋势指标">
                <button className={metric === "tokens" ? "active" : ""} onClick={() => setMetric("tokens")}>
                  Tokens
                </button>
                <button className={metric === "requests" ? "active" : ""} onClick={() => setMetric("requests")}>
                  请求
                </button>
              </div>
            </div>
            <div className="card-body">
              <TrendChart series={o.series} metric={metric} range={range} height={252} />
            </div>
          </section>

          <section className="card">
            <div className="tabs-bar">
              <div className="tabs" role="tablist" aria-label="用量明细">
                {TABS.map((t) => (
                  <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
              <span className="muted">{tab === "requests" ? "仅用量元数据" : "按 Token 用量排序"}</span>
            </div>
            <div className="table-scroll">
              {tab === "requests" ? (
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>工具</th>
                      <th>供应商</th>
                      <th>模型</th>
                      <th className="r">新输入</th>
                      <th className="r">输出</th>
                      <th className="r">缓存读取</th>
                      <th className="r">总计</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.slice(page * pageSize, page * pageSize + pageSize).map((r, i) => (
                      <tr key={`${r.timestampMs}-${page}-${i}`}>
                        <td className="time">{r.timestampMs > 0 ? new Date(r.timestampMs).toLocaleString("zh-CN", timeFmt) : "日期未知"}</td>
                        <td>
                          <span className="table-app">
                            <ToolMark id={r.app} size={20} />
                            {toolName(r.app)}
                          </span>
                        </td>
                        <td>{r.provider || "未知"}</td>
                        <td className="model-name" title={r.model}>
                          {r.model}
                        </td>
                        <td className="r">{number(r.freshInput)}</td>
                        <td className="r">{number(r.outputTokens)}</td>
                        <td className="r" title={number(r.cacheReadTokens)}>
                          {compact(r.cacheReadTokens)}
                        </td>
                        <td className="r strong">{number(r.totalTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="aggregate">
                  <thead>
                    <tr>
                      <th>{{ models: "模型", apps: "工具", providers: "供应商", projects: "项目", requests: "" }[tab]}</th>
                      <th className="share-col">占比</th>
                      <th className="r">总 Tokens</th>
                      <th className="r">新输入</th>
                      <th className="r">输出</th>
                      <th className="r">缓存读取</th>
                      <th className="r">缓存写入</th>
                      {tab === "models" && showCost && <th className="r">估算花费</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows?.map((r, i) => {
                      const c = tab === "models" ? modelCost(prices, r) : null;
                      return (
                        <tr key={r.name}>
                          <td title={r.name} className={tab === "models" ? "model-name" : ""}>
                            {tab === "apps" ? (
                              <span className="table-app">
                                <ToolMark id={r.name} size={20} />
                                {r.name}
                              </span>
                            ) : (
                              r.name || "未知"
                            )}
                          </td>
                          <td className="share-col">
                            <span className="inline-share">
                              <i style={{ width: `${(r.totalTokens / Math.max(o.totalTokens, 1)) * 100}%`, background: findTool(r.name)?.color ?? CHART_COLORS[i % CHART_COLORS.length] }} />
                            </span>
                            <small className="num">{percent(r.totalTokens, o.totalTokens, 1)}</small>
                          </td>
                          <td className="r strong">{number(r.totalTokens)}</td>
                          <td className="r">{number(r.freshInput)}</td>
                          <td className="r">{number(r.outputTokens)}</td>
                          <td className="r">{compact(r.cacheReadTokens)}</td>
                          <td className="r">{compact(r.cacheWriteTokens)}</td>
                          {tab === "models" && showCost && <td className="r">{c === null ? <span className="muted">未定价</span> : money(prices, c)}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {!(tab === "requests" ? requests.length : rows?.length) && (
                <div className="empty compact">
                  <p>当前范围内暂无记录</p>
                </div>
              )}
            </div>
            {tab === "requests" && requests.length > 0 && (
              <div className="pagination">
                <span>
                  共 {number(o.eventCount)} 次请求 · 展示最近 {requests.length} 条
                </span>
                <div>
                  <select aria-label="每页条数" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                    {[10, 20, 50].map((n) => (
                      <option key={n} value={n}>
                        每页 {n} 条
                      </option>
                    ))}
                  </select>
                  <button className="btn sm" aria-label="上一页" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    ‹
                  </button>
                  <span className="num">
                    {page + 1} / {pages}
                  </span>
                  <button className="btn sm" aria-label="下一页" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                    ›
                  </button>
                </div>
              </div>
            )}
          </section>
          <p className="muted foot-note">
            本机日志统计可能与供应商账单存在差异。{!isDesktop && "当前为演示数据。"}
            {matches && o.requests[0]?.timestampMs > 0 && ` 最近一次请求 ${dateTime(new Date(o.requests[0].timestampMs).toISOString())}。`}
          </p>
        </>
      )}
    </div>
  );
}
