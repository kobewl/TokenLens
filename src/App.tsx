import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brain,
  ChartColumn,
  Command as CommandIcon,
  Download,
  FolderPlus,
  LayoutDashboard,
  Monitor,
  Moon,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  RefreshCw,
  Settings as SettingsIcon,
  Sun,
} from "lucide-react";
import CommandPalette, { type Command } from "./CommandPalette";
import EditorMemoryHub, { useEditorMemoryCatalog } from "./EditorMemoryHub";
import { UpdateDialogs, useUpdates } from "./UpdateCenter";
import { call, isDesktop, messageOf } from "./lib/api";
import { toolName } from "./lib/catalog";
import { useSync, type Filters } from "./lib/hooks";
import { isBool, oneOf, usePref, type Theme } from "./lib/prefs";
import { usePriceBook } from "./lib/pricing";
import { applyTheme } from "./lib/theme";
import type { PageId, Project } from "./lib/types";
import Home from "./pages/Home";
import ProjectMemory from "./pages/ProjectMemory";
import Settings from "./pages/Settings";
import Tools from "./pages/Tools";
import Usage from "./pages/Usage";
import Logo from "./ui/Logo";
import { ToastProvider, useToast } from "./ui/Toast";

const NAV: { id: PageId; label: string; icon: typeof LayoutDashboard; key: string; group?: string }[] = [
  { id: "home", label: "概览", icon: LayoutDashboard, key: "1" },
  { id: "usage", label: "用量统计", icon: ChartColumn, key: "2" },
  { id: "tools", label: "工具与来源", icon: Plug, key: "3" },
  { id: "handoffs", label: "项目交接", icon: NotebookPen, key: "4", group: "记忆" },
  { id: "memory", label: "编辑器记忆", icon: Brain, key: "5", group: "记忆" },
];
const ALL_PAGES: PageId[] = ["home", "usage", "tools", "handoffs", "memory", "settings"];
const DEFAULT_FILTERS: Filters = { range: "today", app: "", provider: "", model: "" };

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const toast = useToast();
  const updates = useUpdates();
  const editorMemories = useEditorMemoryCatalog();
  const pricing = usePriceBook();
  const [page, setPage] = useState<PageId>("home");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [theme, setTheme] = usePref<Theme>("tokenlens-theme", "system", oneOf<Theme>("light", "dark", "system"));
  const [auto, setAuto] = usePref<number>("tokenlens-auto-refresh", 30, oneOf(0, 30, 60, 300));
  const [trayTitle, setTrayTitle] = usePref<boolean>("tokenlens-tray-title", true, isBool);
  const [closeToTray, setCloseToTray] = usePref<boolean>("tokenlens-close-to-tray", false, isBool);
  const [collapsed, setCollapsed] = usePref<boolean>("tokenlens-sidebar-collapsed", false, isBool);
  const [project, setProject] = usePref<string>("tokenlens-project", "", (v): v is string => typeof v === "string");
  const [palette, setPalette] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  const onSyncError = useCallback((m: string) => toast("error", m), [toast]);
  const sync = useSync(auto, onSyncError);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme("system");
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, [theme]);

  // Menu-bar behavior lives in Rust; push the stored preference at startup and on every change.
  useEffect(() => {
    if (isDesktop) void call("set_tray_prefs", { showTitle: trayTitle, closeToTray }).catch(() => {});
  }, [trayTitle, closeToTray]);

  const goUsage = useCallback((patch: Partial<Filters>) => {
    setFilters({ ...DEFAULT_FILTERS, ...patch });
    setPage("usage");
  }, []);
  const navigate = useCallback((p: PageId) => {
    setPage(p);
    if (p === "memory") void editorMemories.scan();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (k === ",") {
        e.preventDefault();
        navigate("settings");
      } else if (k === "r") {
        e.preventDefault();
        void sync.refresh();
      } else if (/^[1-5]$/.test(k)) {
        e.preventDefault();
        navigate(ALL_PAGES[Number(k) - 1]);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [navigate, sync.refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!palette) return;
    call<Project[]>("list_projects")
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [palette]);

  const commands = useMemo<Command[]>(() => {
    const ic = (I: typeof Sun) => <I size={16} />;
    const list: Command[] = [
      ...NAV.map((n) => ({ id: `go-${n.id}`, group: "跳转", label: n.label, hint: `⌘${n.key}`, icon: ic(n.icon), run: () => navigate(n.id) })),
      { id: "go-settings", group: "跳转", label: "设置", hint: "⌘,", icon: ic(SettingsIcon), run: () => navigate("settings") },
      { id: "sync", group: "操作", label: "立即同步用量", hint: "⌘R", keywords: "刷新 sync refresh", icon: ic(RefreshCw), run: () => void sync.refresh() },
      {
        id: "add-project",
        group: "操作",
        label: "添加项目",
        keywords: "登记 目录 project",
        icon: ic(FolderPlus),
        run: () =>
          void call<Project | null>("add_project")
            .then((p) => {
              if (p) {
                setProject(p.root);
                navigate("handoffs");
                toast("success", `已添加项目 ${p.name}`);
              }
            })
            .catch((e) => toast("error", messageOf(e))),
      },
      { id: "update", group: "操作", label: "检查更新", keywords: "update version 版本", icon: ic(Download), run: () => void updates.checkUpdates(true) },
      { id: "theme-light", group: "外观", label: "切换到浅色", keywords: "theme light 主题", icon: ic(Sun), run: () => setTheme("light") },
      { id: "theme-dark", group: "外观", label: "切换到深色", keywords: "theme dark 主题", icon: ic(Moon), run: () => setTheme("dark") },
      { id: "theme-system", group: "外观", label: "跟随系统外观", keywords: "theme system 主题", icon: ic(Monitor), run: () => setTheme("system") },
      ...(["today", "7d", "30d", "all"] as const).map((r) => ({
        id: `range-${r}`,
        group: "用量",
        label: `查看${{ today: "今日", "7d": "近 7 天", "30d": "近 30 天", all: "全部时间" }[r]}用量`,
        keywords: "usage 用量 统计",
        icon: ic(ChartColumn),
        run: () => goUsage({ range: r }),
      })),
      ...sync.sources
        .filter((s) => s.events > 0)
        .map((s) => ({ id: `app-${s.app}`, group: "用量", label: `查看 ${toolName(s.app)} 的用量`, keywords: "usage 用量 工具", icon: ic(ChartColumn), run: () => goUsage({ range: "all", app: s.app }) })),
      ...projects.map((p) => ({
        id: `project-${p.root}`,
        group: "项目",
        label: `打开项目 ${p.name}`,
        keywords: p.root,
        icon: ic(NotebookPen),
        run: () => {
          setProject(p.root);
          navigate("handoffs");
        },
      })),
    ];
    return list;
  }, [sync.sources, projects, navigate, goUsage, sync.refresh, updates.checkUpdates, setTheme, setProject, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const Item = ({ n }: { n: (typeof NAV)[number] }) => (
    <button className={page === n.id ? "selected" : ""} aria-current={page === n.id ? "page" : undefined} title={`${n.label} (⌘${n.key})`} onClick={() => navigate(n.id)}>
      <n.icon size={18} />
      <span>{n.label}</span>
    </button>
  );

  return (
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <Logo size={30} />
          <strong>TokenLens</strong>
          <button className="collapse-button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "展开导航" : "收起导航"} title={collapsed ? "展开导航" : "收起导航"}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        <nav aria-label="主导航">
          {NAV.filter((n) => !n.group).map((n) => (
            <Item key={n.id} n={n} />
          ))}
          <span className="nav-label">记忆</span>
          {NAV.filter((n) => n.group).map((n) => (
            <Item key={n.id} n={n} />
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="palette-trigger" onClick={() => setPalette(true)} title="命令面板 (⌘K)">
            <CommandIcon size={16} />
            <span>搜索与命令</span>
            <span className="kbd">⌘K</span>
          </button>
          <button className={page === "settings" ? "selected" : ""} aria-current={page === "settings" ? "page" : undefined} title="设置 (⌘,)" onClick={() => navigate("settings")}>
            <SettingsIcon size={18} />
            <span>设置</span>
            {updates.notify && <i className="dot warn" title="有新版本" />}
          </button>
          <div className="local-note">本机记录 · 隐私优先</div>
        </div>
      </aside>
      <main>
        <div className="page-wrap" key={page}>
          {page === "home" && <Home sync={sync} prices={pricing.book} project={project} setProject={setProject} navigate={navigate} goUsage={goUsage} />}
          {page === "usage" && <Usage sync={sync} prices={pricing.book} filters={filters} setFilters={setFilters} navigate={navigate} />}
          {page === "tools" && <Tools sync={sync} navigate={navigate} goUsage={goUsage} />}
          {page === "handoffs" && <ProjectMemory revision={sync.revision} root={project} setRoot={setProject} onProjectsChanged={() => {}} />}
          {page === "memory" && <EditorMemoryHub catalog={editorMemories} />}
          {page === "settings" && (
            <Settings
              theme={theme}
              setTheme={setTheme}
              auto={auto}
              setAuto={setAuto}
              trayTitle={trayTitle}
              setTrayTitle={setTrayTitle}
              closeToTray={closeToTray}
              setCloseToTray={setCloseToTray}
              pricing={pricing}
              sync={sync}
              updates={updates}
            />
          )}
        </div>
      </main>
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      <UpdateDialogs controller={updates} />
    </div>
  );
}
