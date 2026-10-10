import { useMemo, useState } from "react";
import { compact, dayKey, number } from "../lib/format";
import type { DayTotal } from "../lib/types";

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

/**
 * GitHub-style activity grid (weeks as columns, Monday first). Level thresholds
 * are quartiles of the user's own non-zero days, so it stays meaningful for light and heavy users alike.
 */
export default function Heatmap({ days, weeks = 26 }: { days: DayTotal[]; weeks?: number }) {
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);

  const { cells, labels, levels, byDay } = useMemo(() => {
    const byDay = new Map(days.map((d) => [d.day, d]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monday = (today.getDay() + 6) % 7; // days since Monday
    const start = new Date(today);
    start.setDate(today.getDate() - monday - (weeks - 1) * 7);
    const nonZero = days.map((d) => d.totalTokens).filter((v) => v > 0).sort((a, b) => a - b);
    const q = (p: number) => nonZero[Math.min(nonZero.length - 1, Math.floor(nonZero.length * p))] ?? 0;
    const levels = [q(0.25), q(0.5), q(0.75)];
    const cells: { key: string; future: boolean; col: number; row: number }[] = [];
    const labels: { col: number; text: string }[] = [];
    let lastMonth = -1;
    for (let w = 0; w < weeks; w++)
      for (let r = 0; r < 7; r++) {
        const d = new Date(start);
        d.setDate(start.getDate() + w * 7 + r);
        cells.push({ key: dayKey(d), future: d > today, col: w, row: r });
        if (r === 0 && d.getMonth() !== lastMonth && d <= today) {
          lastMonth = d.getMonth();
          labels.push({ col: w, text: MONTHS[d.getMonth()] });
        }
      }
    return { cells, labels, levels, byDay };
  }, [days, weeks]);

  const level = (v: number) => (v <= 0 ? 0 : v <= levels[0] ? 1 : v <= levels[1] ? 2 : v <= levels[2] ? 3 : 4);
  const tip = hover ? byDay.get(hover.key) : null;

  return (
    <div className="heatmap" onMouseLeave={() => setHover(null)}>
      <div className="heat-months" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
        {labels.map((l) => (
          <span key={l.col} style={{ gridColumn: `${l.col + 1} / span 3` }}>
            {l.text}
          </span>
        ))}
      </div>
      <div className="heat-body">
        <div className="heat-weekdays">
          <span>一</span>
          <span />
          <span>三</span>
          <span />
          <span>五</span>
          <span />
          <span />
        </div>
        <div className="heat-grid" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }} role="img" aria-label={`过去 ${weeks} 周每日 Token 用量热力图`}>
          {cells.map((c) => {
            const v = byDay.get(c.key)?.totalTokens ?? 0;
            return (
              <i
                key={c.key}
                className={`heat-cell l${level(v)} ${c.future ? "future" : ""}`}
                style={{ gridColumn: c.col + 1, gridRow: c.row + 1 }}
                onMouseEnter={(e) => {
                  const r = (e.currentTarget.offsetParent as HTMLElement).getBoundingClientRect();
                  const t = e.currentTarget.getBoundingClientRect();
                  setHover({ key: c.key, x: t.left - r.left + t.width / 2, y: t.top - r.top });
                }}
              />
            );
          })}
          {hover && (
            <div className="heat-tip" style={{ left: hover.x, top: hover.y }}>
              <strong>{hover.key}</strong>
              {tip ? (
                <span className="num">
                  {compact(tip.totalTokens)} Tokens · {number(tip.eventCount)} 次请求
                </span>
              ) : (
                <span>无记录</span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="heat-legend">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} className={`heat-cell l${l}`} />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}
