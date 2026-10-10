const nf = new Intl.NumberFormat("zh-CN");
export const number = (n: number) => nf.format(n);

/** 万 = 10,000, 亿 = 100,000,000: the unit convention used across the app and the menu bar. */
export const compact = (n: number) =>
  n >= 1e8 ? `${(n / 1e8).toFixed(2)}亿` : n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)}万` : nf.format(n);

export const percent = (part: number, whole: number, digits = 0) =>
  whole > 0 ? `${((part / whole) * 100).toFixed(digits)}%` : "—";

export const clock = (d: Date) => d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

export const dateTime = (iso: string) => new Date(iso).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const shortDate = (key: string) => (/^\d{4}-/.test(key) ? key.slice(5).replace("-", "/") : key);

export const relative = (ts: number | string) => {
  const diff = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(diff)) return "";
  const m = Math.round(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} 天前` : new Date(ts).toLocaleDateString("zh-CN");
};

/** Change vs. a baseline. `null` when the baseline is zero so the UI never shows ∞%. */
export function delta(current: number, previous: number): { pct: number; dir: "up" | "down" | "flat" } | null {
  if (previous <= 0) return null;
  const pct = ((current - previous) / previous) * 100;
  return { pct, dir: Math.abs(pct) < 0.5 ? "flat" : pct > 0 ? "up" : "down" };
}
