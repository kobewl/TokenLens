// Fabricated demo data for browser previews. Every number here is invented:
// no real prompts, responses, logs or keys. Shown only outside the desktop app.
import type { DayTotal, NamedTotal, Overview, Project, ProjectMemory, RequestLog, SeriesPoint, SourceReport } from "./types";

type Ev = {
  ts: number;
  app: string;
  provider: string;
  model: string;
  project: string;
  fresh: number;
  out: number;
  cr: number;
  cw: number;
};

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIX = [
  { app: "Claude Code", provider: "anthropic", models: ["claude-sonnet-4.5", "claude-opus-4.1"], w: 0.46 },
  { app: "Codex", provider: "openai", models: ["gpt-5-codex", "gpt-5"], w: 0.24 },
  { app: "Cursor", provider: "cursor", models: ["auto"], w: 0.1 },
  { app: "ZCode", provider: "zhipu", models: ["glm-4.6"], w: 0.1 },
  { app: "Gemini CLI", provider: "google", models: ["gemini-2.5-pro"], w: 0.1 },
];
const PROJECTS = ["tokenlens", "order-service", "docs-site", "mobile-app"];

let cache: Ev[] | null = null;
function events(): Ev[] {
  if (cache) return cache;
  const rand = rng(20261010);
  const out: Ev[] = [];
  const now = new Date();
  for (let d = 0; d < 200; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    if (d > 1 && rand() < (weekend ? 0.5 : 0.08)) continue; // today and yesterday always have data so the preview never opens empty
    const trend = 1 + (200 - d) / 260;
    const count = Math.max(d === 0 ? 14 : 4, Math.round((weekend ? 6 : 26) * (0.4 + rand() * 1.4) * trend));
    for (let i = 0; i < count; i++) {
      const hour = d === 0 ? Math.floor(rand() * (now.getHours() + 1)) : Math.min(23, Math.floor(9 + Math.abs(rand() + rand() - 1) * 14 + rand() * 2));
      const ts = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, Math.floor(rand() * 60), Math.floor(rand() * 60)).getTime();
      if (ts > Date.now()) continue;
      let pick = rand();
      const mix = MIX.find((m) => (pick -= m.w) <= 0) ?? MIX[0];
      const heavy = mix.models[1] && rand() < 0.3;
      const fresh = Math.round(300 + rand() * 4200);
      const outTokens = Math.round(200 + rand() * (heavy ? 3800 : 1800));
      const cr = rand() < 0.8 ? Math.round(rand() * 90000 * trend) : 0;
      out.push({
        ts,
        app: mix.app,
        provider: mix.provider,
        model: heavy ? mix.models[1] : mix.models[0],
        project: PROJECTS[Math.floor(rand() ** 1.6 * PROJECTS.length)],
        fresh,
        out: outTokens,
        cr,
        cw: rand() < 0.3 ? Math.round(rand() * 6000) : 0,
      });
    }
  }
  return (cache = out.sort((a, b) => a.ts - b.ts));
}

const midnight = (offset: number) => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() - offset).getTime();
};
const rangeStart = (range: string) => (range === "7d" ? midnight(6) : range === "30d" ? midnight(29) : range === "all" ? 0 : midnight(0));
const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const blank = (name: string): NamedTotal => ({ name, totalTokens: 0, freshInput: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 });
const bump = (t: NamedTotal, e: Ev) => {
  t.freshInput += e.fresh;
  t.outputTokens += e.out;
  t.cacheReadTokens += e.cr;
  t.cacheWriteTokens += e.cw;
  t.totalTokens += e.fresh + e.out + e.cr + e.cw;
};
const group = (list: Ev[], key: (e: Ev) => string) => {
  const m = new Map<string, NamedTotal>();
  for (const e of list) {
    const k = key(e);
    if (!m.has(k)) m.set(k, blank(k));
    bump(m.get(k)!, e);
  }
  return [...m.values()].sort((a, b) => b.totalTokens - a.totalTokens);
};
const NAME_OF: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", cursor: "Cursor", zcode: "ZCode", "gemini-cli": "Gemini CLI" };
const filtered = (start: number, app?: string | null, provider?: string | null, model?: string | null) =>
  events().filter(
    (e) => e.ts >= start && (!app || e.app === (NAME_OF[app] ?? app)) && (!provider || e.provider === provider) && (!model || e.model === model),
  );

function overview(a: { range: string; app?: string | null; provider?: string | null; model?: string | null }): Overview {
  const start = rangeStart(a.range);
  const inRange = events().filter((e) => e.ts >= start);
  const list = filtered(start, a.app, a.provider, a.model);
  const total = blank("");
  list.forEach((e) => bump(total, e));
  const hourly = a.range === "today";
  const series = new Map<string, SeriesPoint>();
  for (const e of list) {
    const bucket = hourly ? `${pad(new Date(e.ts).getHours())}:00` : dayOf(e.ts);
    const k = `${bucket}|${e.model}`;
    const p = series.get(k) ?? { bucket, model: e.model, totalTokens: 0, eventCount: 0 };
    p.totalTokens += e.fresh + e.out + e.cr + e.cw;
    p.eventCount++;
    series.set(k, p);
  }
  const requests: RequestLog[] = [...list]
    .sort((x, y) => y.ts - x.ts)
    .slice(0, 200)
    .map((e) => ({
      timestampMs: e.ts,
      app: e.app,
      provider: e.provider,
      model: e.model,
      freshInput: e.fresh,
      outputTokens: e.out,
      cacheReadTokens: e.cr,
      cacheWriteTokens: e.cw,
      totalTokens: e.fresh + e.out + e.cr + e.cw,
    }));
  return {
    range: a.range,
    rangeStartMs: start || (events()[0]?.ts ?? Date.now()),
    rangeEndMs: Date.now(),
    undatedCount: 0,
    totalTokens: total.totalTokens,
    freshInput: total.freshInput,
    outputTokens: total.outputTokens,
    cacheReadTokens: total.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens,
    reasoningTokens: 0,
    eventCount: list.length,
    byModel: group(list, (e) => e.model),
    byApp: group(list, (e) => e.app),
    byProject: group(list, (e) => e.project),
    byProvider: group(list, (e) => e.provider),
    series: [...series.values()].sort((x, y) => x.bucket.localeCompare(y.bucket) || x.model.localeCompare(y.model)),
    bucketKind: hourly ? "hour" : "day",
    requests,
    providers: [...new Set(inRange.map((e) => e.provider))].sort(),
    models: [...new Set(inRange.map((e) => e.model))].sort(),
  };
}

function daily(a: { days: number; app?: string | null; provider?: string | null; model?: string | null }): DayTotal[] {
  const m = new Map<string, DayTotal>();
  for (const e of filtered(midnight(Math.max(1, a.days) - 1), a.app, a.provider, a.model)) {
    const k = dayOf(e.ts);
    const d = m.get(k) ?? { day: k, totalTokens: 0, eventCount: 0, freshInput: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    d.totalTokens += e.fresh + e.out + e.cr + e.cw;
    d.eventCount++;
    d.freshInput += e.fresh;
    d.outputTokens += e.out;
    d.cacheReadTokens += e.cr;
    d.cacheWriteTokens += e.cw;
    m.set(k, d);
  }
  return [...m.values()].sort((x, y) => x.day.localeCompare(y.day));
}

const sources = (): SourceReport[] => {
  const count = (app: string) => events().filter((e) => e.app === app).length;
  return [
    { app: "claude-code", events: count("Claude Code"), coverage: "counted", detail: "演示数据：读取 ~/.claude/projects 下的会话记录元数据" },
    { app: "codex", events: count("Codex"), coverage: "counted", detail: "演示数据：读取 ~/.codex/sessions，仅采用单次调用的用量" },
    { app: "zcode", events: count("ZCode"), coverage: "counted", detail: "演示数据：读取 ZCode 本机数据库的用量表" },
    { app: "gemini-cli", events: count("Gemini CLI"), coverage: "counted", detail: "演示数据：读取 Gemini CLI 会话日志中的用量字段" },
    { app: "cursor", events: count("Cursor"), coverage: "partial", detail: "演示数据：只采集带可靠时间戳的调用，上下文大小不计入用量" },
    { app: "kiro", events: 0, coverage: "unavailable", detail: "演示数据：Kiro 仅记录 credits，没有 Token 数" },
    { app: "claude-desktop", events: 0, coverage: "unavailable", detail: "本地未发现可核对的逐次 Token 用量记录" },
    { app: "chatgpt", events: 0, coverage: "unavailable", detail: "桌面应用未提供可读取的本机逐次 Token 用量" },
  ];
};

const hours = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const PROJECT_LIST: Project[] = [
  { root: "/Users/demo/Projects/tokenlens", name: "tokenlens", guidance: true },
  { root: "/Users/demo/Projects/order-service", name: "order-service", guidance: false },
];
const memory = (root: string): ProjectMemory => {
  const first = root.endsWith("tokenlens");
  const events = first
    ? [
        { id: 3, ts: hours(2), tool: "claude-code", summary: "重做概览页：加入今日 Token 环比、趋势图和使用热力图。", done: ["拆分导航与顶栏", "接入每日汇总命令"], next: ["补充设置页的定价表", "在菜单栏显示今日 Token", "检查深色模式对比度"] },
        { id: 2, ts: hours(30), tool: "codex", summary: "整理采集器缓存逻辑，未变化的文件不再重复解析。", done: ["Codex 文件缓存"], next: ["为 Cursor 采集补充时间戳回退说明"] },
        { id: 1, ts: hours(80), tool: "user", summary: "项目初始化，确定 Tauri 2 + React + SQLite。", done: [], next: ["选定首批采集器"] },
      ]
    : [{ id: 1, ts: hours(52), tool: "codex", summary: "梳理订单状态机，明确退款路径。", done: ["状态图"], next: ["补充幂等校验"] }];
  const decisions = first
    ? [
        { id: 2, ts: hours(28), tool: "claude-code", title: "用量估算只使用用户自填的价格", rationale: "价格会变，内置价目表容易给出自信但错误的金额；未定价的模型明确显示“未定价”。", status: "active", supersededBy: null },
        { id: 1, ts: hours(79), tool: "user", title: "默认只存元数据，不存正文", rationale: "本地优先，开源后用户才敢使用。", status: "active", supersededBy: null },
      ]
    : [];
  const brief = first
    ? "# tokenlens 交接简报\n\n## 最近进展\n- 重做概览页：加入今日 Token 环比、趋势图和使用热力图。\n\n## 下一步\n1. 补充设置页的定价表\n2. 在菜单栏显示今日 Token\n3. 检查深色模式对比度\n\n## 有效决策\n- 用量估算只使用用户自填的价格\n- 默认只存元数据，不存正文\n"
    : "# order-service 交接简报\n\n## 最近进展\n- 梳理订单状态机，明确退款路径。\n\n## 下一步\n1. 补充幂等校验\n";
  return { events, decisions, eventCount: events.length, decisionCount: decisions.length, brief };
};

const EDITOR_ENTRIES = [
  { id: "d1", tool: "claude-code", name: "CLAUDE.md", path: "/Users/demo/.claude/CLAUDE.md", scope: "global", project: "", kind: "rule", bytes: 1820, modifiedMs: Date.now() - 5 * 86400_000, readable: true },
  { id: "d2", tool: "claude-code", name: "CLAUDE.md", path: "/Users/demo/Projects/tokenlens/CLAUDE.md", scope: "project", project: "tokenlens", kind: "rule", bytes: 940, modifiedMs: Date.now() - 86400_000, readable: true },
  { id: "d3", tool: "codex", name: "AGENTS.md", path: "/Users/demo/Projects/tokenlens/AGENTS.md", scope: "project", project: "tokenlens", kind: "rule", bytes: 1260, modifiedMs: Date.now() - 3 * 86400_000, readable: true },
  { id: "d4", tool: "cursor", name: "tokenlens.mdc", path: "/Users/demo/Projects/tokenlens/.cursor/rules/tokenlens.mdc", scope: "project", project: "tokenlens", kind: "rule", bytes: 610, modifiedMs: Date.now() - 9 * 86400_000, readable: true },
  { id: "d5", tool: "gemini-cli", name: "GEMINI.md", path: "/Users/demo/.gemini/GEMINI.md", scope: "global", project: "", kind: "memory", bytes: 480, modifiedMs: Date.now() - 12 * 86400_000, readable: true },
];

const demoError = () => new Error("演示模式不会读写任何本机文件。请在 TokenLens 桌面应用中使用此功能。");
type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function demoCall<T>(command: string, a: Args): Promise<T> {
  await new Promise((r) => setTimeout(r, 90));
  const result = ((): unknown => {
    switch (command) {
      case "refresh":
        return sources();
      case "overview":
        return overview(a as Parameters<typeof overview>[0]);
      case "daily_totals":
        return daily(a as Parameters<typeof daily>[0]);
      case "cursor_activity":
        return { chatsToday: 3, chatsWeek: 9, lastCountedMs: Date.now() - 400 * 86400_000 };
      case "set_tray_prefs":
        return null;
      case "list_projects":
        return PROJECT_LIST;
      case "project_memory":
        return memory(String(a.root));
      case "memory_config":
        return `[mcp_servers.tokenlens]\ncommand = "/Applications/TokenLens.app/Contents/MacOS/tokenlens"\nargs = ["--mcp", "--project", "${a.root}", "--tool", "${a.tool}"]\n`;
      case "scan_editor_memories":
        return {
          entries: EDITOR_ENTRIES,
          tools: [
            { tool: "claude-code", detected: true, count: 2, detail: "读取 ~/.claude 与已发现项目中的 CLAUDE.md" },
            { tool: "codex", detected: true, count: 1, detail: "读取项目中的 AGENTS.md" },
            { tool: "cursor", detected: true, count: 1, detail: "读取项目 .cursor/rules" },
            { tool: "gemini-cli", detected: true, count: 1, detail: "读取 ~/.gemini/GEMINI.md" },
            { tool: "kiro", detected: false, count: 0, detail: "未发现 Kiro 规则文件" },
          ],
          projects: PROJECT_LIST.map((p) => ({ name: p.name, root: p.root })),
          warnings: [],
        };
      case "read_editor_memory":
        return { content: "# 演示内容\n\n- 提交信息使用中文，说明改动原因。\n- 不要在日志中输出密钥。\n- 先读 README，再改代码。\n", fingerprint: "demo" };
      default:
        throw demoError();
    }
  })();
  return result as T;
}
