import { useMemo, useState } from "react";
import { ExternalLink, Monitor, Moon, Plus, Sun, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isDesktop, messageOf } from "../lib/api";
import { useOverview, type useSync } from "../lib/hooks";
import type { Theme } from "../lib/prefs";
import type { Price, usePriceBook } from "../lib/pricing";
import { SHORTCUTS } from "../lib/shortcuts";
import Modal from "../ui/Modal";
import PageHeader from "../ui/PageHeader";
import { useToast } from "../ui/Toast";
import { UpdateSettings, type useUpdates } from "../UpdateCenter";

type Props = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  auto: number;
  setAuto: (n: number) => void;
  trayTitle: boolean;
  setTrayTitle: (b: boolean) => void;
  closeToTray: boolean;
  setCloseToTray: (b: boolean) => void;
  pricing: ReturnType<typeof usePriceBook>;
  sync: ReturnType<typeof useSync>;
  updates: ReturnType<typeof useUpdates>;
};

const FIELDS: { key: keyof Price; label: string }[] = [
  { key: "input", label: "新输入" },
  { key: "output", label: "输出" },
  { key: "cacheRead", label: "缓存读取" },
  { key: "cacheWrite", label: "缓存写入" },
];
const REPO = "https://github.com/kobewl/TokenLens";

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        {desc && <p>{desc}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export default function Settings({ theme, setTheme, auto, setAuto, trayTitle, setTrayTitle, closeToTray, setCloseToTray, pricing, sync, updates }: Props) {
  const toast = useToast();
  const all = useOverview({ range: "all", app: "", provider: "", model: "" }, sync.revision);
  const { book, save } = pricing;
  const [manual, setManual] = useState("");
  const [extra, setExtra] = useState<string[]>([]);
  const [showAllModels, setShowAllModels] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const models = useMemo(() => {
    const names = new Set([...(all.data?.models ?? []), ...Object.keys(book.models), ...extra]);
    return [...names].filter(Boolean).sort((a, b) => Number(b in book.models) - Number(a in book.models) || a.localeCompare(b));
  }, [all.data, book.models, extra]);
  const shown = showAllModels ? models : models.slice(0, 8);

  function commit(model: string, form: HTMLFormElement) {
    const data = new FormData(form);
    const price = Object.fromEntries(FIELDS.map((f) => [f.key, Number(data.get(f.key) || 0)])) as Price;
    const next = { ...book.models };
    if (Object.values(price).every((v) => !v)) delete next[model];
    else next[model] = price;
    save({ ...book, models: next });
  }
  function addManual() {
    const name = manual.trim();
    if (!name) return;
    // Only list the model; a price is stored once the user actually types one (all-zero would mean "free").
    setExtra((list) => (list.includes(name) ? list : [...list, name]));
    setShowAllModels(true);
    setManual("");
  }
  async function clearUsage() {
    setBusy(true);
    try {
      if (!(await sync.clear())) {
        toast("error", "同步正在进行中，请完成后再清空");
        return;
      }
      setAuto(0);
      setConfirm(false);
      toast("success", "本地用量已清空，自动同步已关闭。再次同步会重新读取来源记录。");
    } catch (e) {
      toast("error", `清空失败：${messageOf(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <PageHeader title="设置" subtitle="外观、同步、菜单栏、估算定价和数据管理" />

      <section className="card settings-group">
        <h2>通用</h2>
        <Row title="外观" desc="选择界面的显示主题">
          <div className="seg" role="group" aria-label="外观">
            {(
              [
                ["light", "浅色", Sun],
                ["dark", "深色", Moon],
                ["system", "跟随系统", Monitor],
              ] as const
            ).map(([id, label, I]) => (
              <button key={id} className={theme === id ? "active" : ""} onClick={() => setTheme(id)}>
                <I size={14} />
                {label}
              </button>
            ))}
          </div>
        </Row>
        <Row title="自动同步" desc="窗口打开时定时读取本机会话记录">
          <div className="seg" role="group" aria-label="自动同步">
            {(
              [
                [0, "关闭"],
                [30, "30 秒"],
                [60, "1 分钟"],
                [300, "5 分钟"],
              ] as const
            ).map(([v, label]) => (
              <button key={v} className={auto === v ? "active" : ""} onClick={() => setAuto(v)}>
                {label}
              </button>
            ))}
          </div>
        </Row>
      </section>

      <section className="card settings-group">
        <h2>菜单栏与窗口</h2>
        <Row title="在菜单栏显示今日 Token" desc="点击菜单栏图标可查看今日用量、最常用工具，并一键同步。">
          <input type="checkbox" className="switch" role="switch" aria-label="在菜单栏显示今日 Token" checked={trayTitle} disabled={!isDesktop} onChange={(e) => setTrayTitle(e.target.checked)} />
        </Row>
        <Row title="关闭窗口后继续在菜单栏运行" desc="窗口隐藏期间每分钟自动同步一次；从菜单栏图标或 Dock 可重新打开。通过菜单栏「退出」才会真正退出。">
          <input type="checkbox" className="switch" role="switch" aria-label="关闭窗口后继续在菜单栏运行" checked={closeToTray} disabled={!isDesktop} onChange={(e) => setCloseToTray(e.target.checked)} />
        </Row>
        {!isDesktop && <p className="muted group-note">菜单栏功能仅在桌面应用中可用。</p>}
      </section>

      <section className="card settings-group">
        <div className="group-head">
          <h2>估算定价</h2>
          <div className="seg" role="group" aria-label="货币">
            {(["$", "¥"] as const).map((c) => (
              <button key={c} className={book.currency === c ? "active" : ""} onClick={() => save({ ...book, currency: c })}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <p className="muted group-note">
          填写你所用模型的单价（每 100 万 Token），用量页和概览就会显示估算花费。TokenLens <b>不内置价目表</b>：价格会变，没有填写的模型会显示「未定价」，不会给出猜测的金额。留空即删除该模型的价格。
        </p>
        {models.length === 0 ? (
          <p className="muted group-note">还没有读取到任何模型。同步用量后，这里会列出你用过的模型。</p>
        ) : (
          <div className="price-table">
            <div className="price-row head">
              <span>模型</span>
              {FIELDS.map((f) => (
                <span key={f.key}>{f.label}</span>
              ))}
              <span />
            </div>
            {shown.map((m) => {
              const p = book.models[m];
              return (
                <form
                  key={`${m}-${JSON.stringify(p ?? 0)}`}
                  className="price-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    commit(m, e.currentTarget);
                  }}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit(m, e.currentTarget);
                  }}
                >
                  <span className="mono model-cell" title={m}>
                    {m}
                    {p ? <i className="dot good" title="已定价" /> : <small>未定价</small>}
                  </span>
                  {FIELDS.map((f) => (
                    <input key={f.key} name={f.key} className="input" type="number" min="0" step="any" inputMode="decimal" aria-label={`${m} ${f.label}单价`} placeholder="—" defaultValue={p?.[f.key] || ""} />
                  ))}
                  <button type="button" className="btn ghost icon sm" aria-label={`清除 ${m} 的价格`} disabled={!p} onClick={() => save({ ...book, models: Object.fromEntries(Object.entries(book.models).filter(([k]) => k !== m)) })}>
                    <Trash2 size={14} />
                  </button>
                </form>
              );
            })}
          </div>
        )}
        <div className="price-foot">
          {models.length > 8 && (
            <button className="text-action" onClick={() => setShowAllModels((v) => !v)}>
              {showAllModels ? "收起" : `显示全部 ${models.length} 个模型`}
            </button>
          )}
          <form
            className="price-add"
            onSubmit={(e) => {
              e.preventDefault();
              addManual();
            }}
          >
            <input className="input" aria-label="手动添加模型" placeholder="手动添加模型名" value={manual} onChange={(e) => setManual(e.target.value)} />
            <button className="btn sm" disabled={!manual.trim()}>
              <Plus size={14} />
              添加
            </button>
          </form>
        </div>
      </section>

      <section className="card settings-group">
        <h2>应用更新</h2>
        <UpdateSettings controller={updates} />
      </section>

      <section className="card settings-group">
        <h2>数据管理</h2>
        <Row title="清空本地用量" desc="只清空 TokenLens 保存的统计，不影响各工具的原始日志、项目记忆与外观设置。再次同步会重新导入。">
          <button className="btn danger" disabled={!isDesktop || sync.refreshing} onClick={() => setConfirm(true)}>
            <Trash2 size={14} />
            清空用量
          </button>
        </Row>
        <p className="muted group-note">TokenLens 仅保存用量元数据（时间、工具、模型、Token 数、项目名），不保存提示词、回答或密钥。</p>
      </section>

      <section className="card settings-group">
        <h2>关于与快捷键</h2>
        <Row title={`TokenLens v${updates.version}`} desc="See where your AI tokens go. 本地优先，MIT 许可。">
          <button className="btn" onClick={() => void (isDesktop ? openUrl(REPO) : window.open(REPO, "_blank"))}>
            GitHub <ExternalLink size={13} />
          </button>
        </Row>
        <ul className="shortcut-list">
          {SHORTCUTS.map((s) => (
            <li key={s.keys}>
              <span className="kbd">{s.keys}</span>
              {s.label}
            </li>
          ))}
        </ul>
      </section>

      {confirm && (
        <Modal title="确认清空所有已采集用量？" subtitle="自动同步将关闭；再次同步会重新导入来源日志中的记录。" onClose={() => setConfirm(false)} busy={busy} width={460}>
          <div className="modal-actions">
            <button className="btn" disabled={busy} onClick={() => setConfirm(false)}>
              取消
            </button>
            <button className="btn danger solid" disabled={busy} onClick={() => void clearUsage()}>
              {busy ? "正在清空…" : "确认清空"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
