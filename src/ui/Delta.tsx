import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { delta } from "../lib/format";

/** Period-over-period change chip. Neutral colors on purpose: more usage is not "good" or "bad". */
export default function Delta({ current, previous, label }: { current: number; previous: number; label: string }) {
  const d = delta(current, previous);
  if (!d) return <span className="delta none">{label}：暂无对比</span>;
  const Icon = d.dir === "up" ? ArrowUp : d.dir === "down" ? ArrowDown : Minus;
  return (
    <span className={`delta ${d.dir}`} title={`${label}：${previous.toLocaleString("zh-CN")}`}>
      <Icon size={12} strokeWidth={2.6} />
      {d.dir === "flat" ? "持平" : `${Math.abs(d.pct).toFixed(d.pct >= 100 ? 0 : 1)}%`}
      <em>{label}</em>
    </span>
  );
}
