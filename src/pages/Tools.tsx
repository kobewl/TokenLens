import { useMemo, useState } from "react";
import { ArrowRight, NotebookPen, Search } from "lucide-react";
import { COVERAGE, TOOLS, findTool, type Tool, type ToolKind } from "../lib/catalog";
import { compact, number } from "../lib/format";
import { useOverview, type Filters, type useSync } from "../lib/hooks";
import type { PageId } from "../lib/types";
import PageHeader from "../ui/PageHeader";
import SyncPill from "../ui/SyncPill";
import ToolMark from "../ui/ToolMark";

type Props = {
  sync: ReturnType<typeof useSync>;
  navigate: (page: PageId) => void;
  goUsage: (f: Partial<Filters>) => void;
};
type View = "all" | "active" | "attention";

const badgeTone = (coverage?: string) =>
  coverage === "counted" ? "good" : coverage === "partial" ? "warn" : coverage === "error" ? "bad" : "";

export default function Tools({ sync, navigate, goUsage }: Props) {
  const all = useOverview({ range: "all", app: "", provider: "", model: "" }, sync.revision);
  const [kind, setKind] = useState<"全部" | ToolKind>("全部");
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");

  const cards = useMemo(() => {
    const known = new Set(TOOLS.map((t) => t.id));
    const extra: Tool[] = sync.sources
      .filter((s) => !known.has(s.app))
      .map((s) => ({ id: s.app, name: s.app, kind: "CLI", about: "已发现的数据来源", glyph: s.app.slice(0, 2), color: "#8b95a5", memory: false }));
    return [...TOOLS, ...extra].map((tool) => {
      const source = sync.sources.find((s) => s.app === tool.id);
      const tokens = all.data?.byApp.find((a) => findTool(a.name)?.id === tool.id)?.totalTokens ?? 0;
      return { tool, source, tokens };
    });
  }, [sync.sources, all.data]);

  const visible = cards
    .filter(({ tool, source }) => {
      if (kind !== "全部" && tool.kind !== kind) return false;
      if (view === "active" && !(source && source.events > 0)) return false;
      if (view === "attention" && !(source && (source.coverage === "error" || source.coverage === "partial"))) return false;
      return `${tool.name} ${tool.about}`.toLowerCase().includes(query.trim().toLowerCase());
    })
    .sort((a, b) => b.tokens - a.tokens || (b.source?.events ?? 0) - (a.source?.events ?? 0));

  const count = (c: string) => sync.sources.filter((s) => s.coverage === c).length;
  const synced = sync.sources.length > 0;

  return (
    <div className="page">
      <PageHeader
        title="工具与数据来源"
        subtitle="TokenLens 能读取哪些工具的用量，以及各来源当前的采集状态"
        actions={<SyncPill refreshing={sync.refreshing} synced={sync.synced} onRefresh={() => void sync.refresh()} />}
      />

      <section className="kpis small">
        <article className="stat">
          <div className="stat-label">已采集</div>
          <strong className="num">{synced ? count("counted") : "—"}</strong>
          <p className="stat-sub">有可核对的逐次用量</p>
        </article>
        <article className="stat">
          <div className="stat-label">部分采集</div>
          <strong className="num">{synced ? count("partial") : "—"}</strong>
          <p className="stat-sub">仅含带可靠时间戳的调用</p>
        </article>
        <article className="stat">
          <div className="stat-label">暂无法采集</div>
          <strong className="num">{synced ? count("unavailable") : "—"}</strong>
          <p className="stat-sub">本机未提供 Token 数</p>
        </article>
        <article className="stat">
          <div className="stat-label">累计 Tokens</div>
          <strong className="num">{all.data ? compact(all.data.totalTokens) : "—"}</strong>
          <p className="stat-sub num">{all.data ? `${number(all.data.eventCount)} 次请求` : ""}</p>
        </article>
      </section>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="工具类型">
          {(["全部", "CLI", "IDE", "桌面"] as const).map((k) => (
            <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="采集状态">
          {(
            [
              ["all", "全部"],
              ["active", "有用量"],
              ["attention", "需关注"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </div>
        <label className="input-icon search">
          <Search size={15} />
          <input className="input" aria-label="搜索工具" placeholder="搜索工具或用途" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      <div className="tool-grid">
        {visible.map(({ tool, source, tokens }) => (
          <article className="tool-card" key={tool.id}>
            <div className="tool-card-head">
              <ToolMark id={tool.id} size={38} />
              <div>
                <h3>{tool.name}</h3>
                <span>
                  {tool.kind} · {tool.about}
                </span>
              </div>
              <span className={`badge ${badgeTone(source?.coverage)}`}>{source ? (COVERAGE[source.coverage] ?? source.coverage) : "未检测"}</span>
            </div>
            <div className="tool-usage">
              <strong className="num">{tokens > 0 ? compact(tokens) : "—"}</strong>
              <span>累计 Tokens{source && source.events > 0 ? ` · ${number(source.events)} 次请求` : ""}</span>
            </div>
            <p className="tool-detail" title={source?.detail}>
              {source?.detail ?? "尚无采集器。工具目录不代表已安装；可以先接入项目记忆。"}
            </p>
            <div className="tool-card-actions">
              <button className="btn sm" disabled={!source?.events} onClick={() => goUsage({ range: "all", app: tool.id, provider: "", model: "" })}>
                查看用量 <ArrowRight size={13} />
              </button>
              {tool.memory && (
                <button className="btn sm ghost" onClick={() => navigate("handoffs")}>
                  <NotebookPen size={13} />
                  接入记忆
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!visible.length && (
        <div className="empty">
          <strong>没有匹配的工具</strong>
          <p>调整类型、状态或搜索条件。</p>
        </div>
      )}
      <p className="muted foot-note">
        工具目录不代表已安装。用量状态来自本机采集器，只统计能读取到 Token 数的记录；MCP 配置是通用片段，接入后仍需在对应工具中验证。
      </p>
    </div>
  );
}
