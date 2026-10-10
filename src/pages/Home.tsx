import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Clock, Copy, FolderPlus, Lightbulb, Plug, Sparkles, TriangleAlert, Flame, Gauge, Trophy } from "lucide-react";
import { call, isDesktop, messageOf } from "../lib/api";
import { CHART_COLORS, findTool, toolId } from "../lib/catalog";
import { clock, compact, number, percent, relative } from "../lib/format";
import { useDaily, useOverview, windowTotal, type Filters, type useSync } from "../lib/hooks";
import { money, totalCost, type PriceBook } from "../lib/pricing";
import type { CursorActivity, PageId, Project, ProjectMemory } from "../lib/types";
import Delta from "../ui/Delta";
import PageHeader from "../ui/PageHeader";
import ShareBars from "../ui/ShareBars";
import Stat from "../ui/Stat";
import SyncPill from "../ui/SyncPill";
import ToolMark from "../ui/ToolMark";
import { useToast } from "../ui/Toast";
import Heatmap from "../charts/Heatmap";
import TrendChart, { type Metric } from "../charts/TrendChart";

type Props = {
  sync: ReturnType<typeof useSync>;
  prices: PriceBook;
  project: string;
  setProject: (root: string) => void;
  navigate: (page: PageId) => void;
  goUsage: (f: Partial<Filters>) => void;
};

const longDate = () => new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });

function streak(days: { day: string; totalTokens: number }[]) {
  const active = new Set(days.filter((d) => d.totalTokens > 0).map((d) => d.day));
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const cursor = new Date();
  if (!active.has(key(cursor))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (active.has(key(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

export default function Home({ sync, prices, project, setProject, navigate, goUsage }: Props) {
  const toast = useToast();
  const { revision } = sync;
  const today = useOverview({ range: "today", app: "", provider: "", model: "" }, revision);
  const month = useOverview({ range: "30d", app: "", provider: "", model: "" }, revision);
  const daily = useDaily(190, {}, revision);
  const [metric, setMetric] = useState<Metric>("tokens");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const [cursor, setCursor] = useState<CursorActivity | null>(null);

  // Cursor no longer writes per-request token counts, so it can be busy all day yet add nothing to the totals.
  useEffect(() => {
    let alive = true;
    call<CursorActivity>("cursor_activity")
      .then((a) => alive && setCursor(a))
      .catch(() => alive && setCursor(null));
    return () => void (alive = false);
  }, [revision]);

  useEffect(() => {
    let alive = true;
    call<Project[]>("list_projects")
      .then((p) => alive && setProjects(p))
      .catch(() => alive && setProjects([]));
    return () => void (alive = false);
  }, [version]);

  const active = projects?.find((p) => p.root === project) ?? projects?.[0];
  useEffect(() => {
    if (!active) {
      setMemory(null);
      return;
    }
    let alive = true;
    setMemoryLoading(true);
    call<ProjectMemory>("project_memory", { root: active.root, query: "" })
      .then((m) => alive && setMemory(m))
      .catch(() => alive && setMemory(null))
      .finally(() => alive && setMemoryLoading(false));
    return () => void (alive = false);
  }, [active?.root, revision, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = today.data;
  const yesterday = useMemo(() => windowTotal(daily.days, 1, 1), [daily.days]);
  const week = useMemo(() => windowTotal(daily.days, 7), [daily.days]);
  const prevWeek = useMemo(() => windowTotal(daily.days, 7, 7), [daily.days]);
  const hit = week.fresh + week.cacheRead + week.cacheWrite;
  const trendSeries = useMemo(() => {
    const from = new Date();
    from.setDate(from.getDate() - 13);
    const key = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;
    return (month.data?.series ?? []).filter((p) => p.bucket >= key);
  }, [month.data]);
  const cost = t ? totalCost(prices, t.byModel) : null;
  const loading = !t || !daily.loaded;
  const cursorGap = !!cursor && cursor.chatsToday > 0 && !t?.byApp.some((r) => toolId(r.name) === "cursor" && r.totalTokens > 0);
  const noRecentData = daily.loaded && sync.synced !== null && daily.days.length === 0;
  const activeDays = daily.days.filter((d) => d.totalTokens > 0).length;
  const run = streak(daily.days);

  const insights = useMemo(() => {
    const list: { icon: typeof Sparkles; text: string; tone?: "warn" }[] = [];
    if (t && t.totalTokens > 0) {
      const top = t.byApp[0];
      list.push({ icon: Trophy, text: `今天最常用 ${top.name}，占 ${percent(top.totalTokens, t.totalTokens)} 的 Token。` });
      const peak = [...(t.series ?? [])].reduce<Record<string, number>>((m, p) => ({ ...m, [p.bucket]: (m[p.bucket] ?? 0) + p.eventCount }), {});
      const best = Object.entries(peak).sort((a, b) => b[1] - a[1])[0];
      if (best) list.push({ icon: Clock, text: `${best[0]} 前后最活跃，共 ${number(best[1])} 次请求。` });
    }
    if (hit > 0 && week.cacheRead > 0) list.push({ icon: Gauge, text: `近 7 日缓存命中率 ${percent(week.cacheRead, hit, 1)}，缓存读取 ${compact(week.cacheRead)} Tokens。` });
    if (run >= 2) list.push({ icon: Flame, text: `已连续 ${run} 天使用 AI 工具。` });
    const broken = sync.sources.filter((s) => s.coverage === "error");
    if (broken.length) list.push({ icon: TriangleAlert, tone: "warn", text: `${broken.length} 个来源读取失败，到「工具」页查看原因。` });
    return list.slice(0, 5);
  }, [t, hit, week.cacheRead, run, sync.sources]);

  async function addProject() {
    try {
      const p = await call<Project | null>("add_project");
      if (p) {
        setProject(p.root);
        setVersion((v) => v + 1);
        toast("success", `已添加项目 ${p.name}`);
      }
    } catch (e) {
      toast("error", messageOf(e));
    }
  }
  async function copyBrief() {
    if (!memory) return;
    try {
      await navigator.clipboard.writeText(memory.brief);
      toast("success", "交接简报已复制，粘贴给任意工具即可接着工作");
    } catch {
      toast("error", "复制失败，请到项目交接页手动复制");
    }
  }

  const appRows = (t?.byApp ?? []).slice(0, 6).map((r, i) => ({
    key: r.name,
    label: (
      <span className="share-name">
        <ToolMark id={r.name} size={20} />
        {r.name}
      </span>
    ),
    value: r.totalTokens,
    color: findTool(r.name)?.color ?? CHART_COLORS[i % CHART_COLORS.length],
    right: compact(r.totalTokens),
  }));
  const latest = memory?.events[0];

  return (
    <div className="page">
      <PageHeader title="概览" subtitle={longDate()} actions={<SyncPill refreshing={sync.refreshing} synced={sync.synced} onRefresh={() => void sync.refresh()} />} />

      {noRecentData && (
        <div className="callout">
          <div className="callout-icon">
            <Sparkles size={18} />
          </div>
          <div>
            <strong>还没有读取到用量记录</strong>
            <p>TokenLens 自动读取本机 Claude Code、Codex、ZCode、Gemini CLI、Cursor 的用量元数据，不读取对话内容。先用一次这些工具，或到「工具」页检查数据来源状态。</p>
          </div>
          <button className="btn" onClick={() => navigate("tools")}>
            查看数据来源 <ArrowRight size={14} />
          </button>
        </div>
      )}

      {cursorGap && cursor && (
        <div className="callout">
          <div className="callout-icon">
            <ToolMark id="cursor" size={22} />
          </div>
          <div>
            <strong>
              Cursor 今天有 {cursor.chatsToday} 个对话在使用，但没有计入 Token
            </strong>
            <p>
              这台电脑上 Cursor 的本地数据库没有记录近期每次请求的 Token 数（{cursor.lastCountedMs > 0 ? `最近一条带 Token 的记录是 ${new Date(cursor.lastCountedMs).toLocaleDateString("zh-CN")}` : "没有任何带 Token 的记录"}）。TokenLens 只读本机数据，不读取登录凭据，也不拿“上下文大小”冒充消耗，所以上面的数字不含 Cursor。
            </p>
          </div>
          <button className="btn" onClick={() => navigate("tools")}>
            了解详情 <ArrowRight size={14} />
          </button>
        </div>
      )}

      <section className="kpis" aria-label="用量概览">
        <Stat
          label="今日 Tokens"
          value={t ? compact(t.totalTokens) : "—"}
          sub={t ? `${number(t.totalTokens)} Tokens` : undefined}
          loading={loading}
          footer={<Delta current={t?.totalTokens ?? 0} previous={yesterday.tokens} label="较昨日全天" />}
          help="包含新输入、输出与缓存 Token；与菜单栏数字使用同一口径。"
        />
        <Stat
          label="今日请求"
          value={t ? number(t.eventCount) : "—"}
          sub={t && t.eventCount ? `平均每次 ${compact(Math.round(t.totalTokens / t.eventCount))} Tokens` : "今天还没有请求"}
          loading={loading}
          footer={<Delta current={t?.eventCount ?? 0} previous={yesterday.events} label="较昨日全天" />}
        />
        <Stat
          label="近 7 日 Tokens"
          value={daily.loaded ? compact(week.tokens) : "—"}
          sub={daily.loaded ? `${number(week.events)} 次请求` : undefined}
          loading={!daily.loaded}
          footer={<Delta current={week.tokens} previous={prevWeek.tokens} label="较前 7 日" />}
        />
        {cost && cost.priced > 0 ? (
          <Stat
            label="今日估算花费"
            value={money(prices, cost.cost)}
            sub={cost.unpriced ? `另有 ${cost.unpriced} 个模型未定价` : "按你填写的价格估算"}
            loading={loading}
            help="价格由你在「设置 → 估算定价」填写，TokenLens 不内置价目表。"
          />
        ) : (
          <Stat
            label="近 7 日缓存命中率"
            value={hit > 0 && week.cacheRead > 0 ? percent(week.cacheRead, hit, 1) : "—"}
            sub={week.cacheRead > 0 ? `缓存读取 ${compact(week.cacheRead)} Tokens` : "近 7 日没有缓存读取记录"}
            loading={!daily.loaded}
            help="缓存读取 /（新输入 + 缓存读取 + 缓存写入）。"
          />
        )}
      </section>

      <div className="grid g21">
        <section className="card">
          <div className="card-head">
            <div>
              <h3>近 14 天趋势</h3>
              <p className="sub">按模型堆叠</p>
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
            <TrendChart series={trendSeries} metric={metric} range="7d" days={14} height={220} empty="近 14 天暂无用量" />
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h3>今日工具占比</h3>
              <p className="sub">按 Token 用量</p>
            </div>
            <button className="text-action" onClick={() => goUsage({ range: "today" })}>
              详情 <ArrowRight size={13} />
            </button>
          </div>
          <div className="card-body">
            {appRows.length ? (
              <ShareBars rows={appRows} total={t?.totalTokens ?? 0} />
            ) : (
              <div className="empty compact">
                <p>{loading ? "正在读取…" : "今天还没有用量。开始使用任意 AI 工具后会出现在这里。"}</p>
              </div>
            )}
            {appRows.length > 0 && (
              <div className="chips">
                {t!.byApp.slice(0, 6).map((r) => (
                  <button key={r.name} className="chip-btn" onClick={() => goUsage({ range: "today", app: toolId(r.name) })}>
                    {r.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h3>活跃度</h3>
            <p className="sub">过去 26 周，每格为一天的 Token 用量</p>
          </div>
          <span className="muted num">
            {activeDays} 个活跃日{run >= 2 ? ` · 当前连续 ${run} 天` : ""}
          </span>
        </div>
        <div className="card-body">
          <Heatmap days={daily.days} />
        </div>
      </section>

      <div className="grid g11">
        <section className="card">
          <div className="card-head">
            <div>
              <h3>继续工作</h3>
              <p className="sub">项目记忆让不同工具接力同一件事</p>
            </div>
            {projects && projects.length > 1 && (
              <select aria-label="选择项目" value={active?.root} onChange={(e) => setProject(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.root} value={p.root}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="card-body">
            {projects === null ? (
              <div className="skeleton" style={{ height: 96 }} />
            ) : !active ? (
              <div className="empty compact">
                <div className="empty-icon">
                  <FolderPlus size={20} />
                </div>
                <strong>把第一个项目带进来</strong>
                <p>登记项目目录后，可以记录进度、下一步和决策，换工具时一键交接。</p>
                <button className="btn primary" onClick={() => void addProject()}>
                  添加项目
                </button>
              </div>
            ) : memoryLoading && !memory ? (
              <div className="skeleton" style={{ height: 96 }} />
            ) : latest ? (
              <div className="resume">
                <p className="resume-summary">{latest.summary}</p>
                <p className="muted resume-meta">
                  {active.name} · {findTool(latest.tool)?.name ?? latest.tool} · {relative(latest.ts)}
                </p>
                {latest.next.length > 0 && (
                  <ol className="next-list-mini">
                    {latest.next.slice(0, 3).map((n, i) => (
                      <li key={i}>
                        <span>{i + 1}</span>
                        {n}
                      </li>
                    ))}
                  </ol>
                )}
                <div className="row-actions">
                  <button className="btn primary sm" onClick={() => void copyBrief()}>
                    <Copy size={14} />
                    复制交接简报
                  </button>
                  <button className="btn sm" onClick={() => (setProject(active.root), navigate("handoffs"))}>
                    查看项目记忆
                  </button>
                </div>
              </div>
            ) : (
              <div className="empty compact">
                <strong>{active.name} 还没有交接</strong>
                <p>写下进度和下一步，其他编辑器就能接着做。</p>
                <button className="btn" onClick={() => (setProject(active.root), navigate("handoffs"))}>
                  去写第一条交接
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h3>洞察</h3>
              <p className="sub">根据你的本机记录自动生成</p>
            </div>
          </div>
          <div className="card-body">
            {insights.length ? (
              <ul className="insights">
                {insights.map((x, i) => (
                  <li key={i} className={x.tone}>
                    <x.icon size={16} />
                    <span>{x.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty compact">
                <div className="empty-icon">
                  <Lightbulb size={20} />
                </div>
                <p>有了用量记录后，这里会给出最常用的工具、活跃时段和缓存命中情况。</p>
              </div>
            )}
            <div className="source-line">
              <Plug size={14} />
              <span>
                {sync.sources.filter((s) => s.events > 0).length} 个工具有用量记录
                {sync.synced ? ` · ${clock(sync.synced)} 同步` : ""}
              </span>
              <button className="text-action" onClick={() => navigate("tools")}>
                工具与数据来源
              </button>
            </div>
          </div>
        </section>
      </div>
      {!isDesktop && <p className="muted foot-note">以上为演示数据，用于预览界面。桌面应用中显示你本机的真实用量。</p>}
    </div>
  );
}
