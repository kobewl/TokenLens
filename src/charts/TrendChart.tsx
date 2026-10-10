import { useEffect, useMemo, useState } from "react";
import { CHART_COLORS, OTHER_COLOR } from "../lib/catalog";
import { compact, dayKey, number, shortDate } from "../lib/format";
import type { Range, SeriesPoint } from "../lib/types";
import { useWidth } from "./useWidth";

export type Metric = "requests" | "tokens";
const MAX_SEGMENTS = 6;

/** 1 / 2 / 2.5 / 5 / 10 × 10ⁿ: round axis maxima instead of ugly 1.37亿. */
function niceMax(raw: number) {
  const order = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * order >= raw) return m * order;
  return 10 * order;
}

function fillBuckets(keys: Set<string>, range: Range, count?: number) {
  if (range === "today")
    for (let h = 0; h < 24; h++) keys.add(`${String(h).padStart(2, "0")}:00`);
  const days = count ?? (range === "7d" ? 7 : range === "30d" ? 30 : 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    keys.add(dayKey(d));
  }
}

/** Stacked bars: one segment per top model. Colors follow the model's rank, so they stay stable per view. */
export default function TrendChart({
  series,
  metric,
  range,
  days,
  height = 232,
  legend = true,
  empty,
}: {
  series: SeriesPoint[];
  metric: Metric;
  range: Range;
  /** Force a trailing N-day window (used by Home's 14-day view). */
  days?: number;
  height?: number;
  legend?: boolean;
  empty?: string;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const value = (p: SeriesPoint) => (metric === "requests" ? p.eventCount : p.totalTokens);

  const { models, buckets, max } = useMemo(() => {
    const perModel = new Map<string, number>();
    const perBucket = new Map<string, Map<string, number>>();
    for (const p of series) {
      perModel.set(p.model, (perModel.get(p.model) ?? 0) + value(p));
      const m = perBucket.get(p.bucket) ?? new Map<string, number>();
      m.set(p.model, (m.get(p.model) ?? 0) + value(p));
      perBucket.set(p.bucket, m);
    }
    const ranked = [...perModel].sort((a, b) => b[1] - a[1]).map(([m]) => m);
    const top = ranked.slice(0, MAX_SEGMENTS);
    const keys = new Set(perBucket.keys());
    fillBuckets(keys, range, days);
    const sorted = [...keys].filter((k) => k !== "日期未知").sort();
    const rows = sorted.map((bucket) => {
      const m = perBucket.get(bucket) ?? new Map<string, number>();
      const parts = top.map((model) => ({ model, v: m.get(model) ?? 0 }));
      const other = [...m].filter(([model]) => !top.includes(model)).reduce((s, [, v]) => s + v, 0);
      if (other > 0) parts.push({ model: "其他", v: other });
      return { bucket, parts, total: parts.reduce((s, p) => s + p.v, 0) };
    });
    const peak = Math.max(...rows.map((r) => r.total), 0);
    return { models: ranked.length > MAX_SEGMENTS ? [...top, "其他"] : top, buckets: rows, max: niceMax(Math.max(peak, metric === "requests" ? 4 : 1)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, metric, range, days]);

  useEffect(() => setHover(null), [buckets]);

  const color = (model: string) => (model === "其他" ? OTHER_COLOR : CHART_COLORS[models.indexOf(model) % CHART_COLORS.length]);
  const left = 48;
  const right = 8;
  const top = 10;
  const bottom = 26;
  const innerW = Math.max(1, width - left - right);
  const innerH = height - top - bottom;
  const step = innerW / Math.max(buckets.length, 1);
  const barW = Math.max(2, Math.min(34, step * 0.7));
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor(innerW / 64))));
  const hasData = series.length > 0;
  const active = hover === null ? null : buckets[hover];
  const unit = metric === "requests" ? "请求" : "Tokens";
  const tipLeft = hover === null ? 0 : Math.min(width - 190, Math.max(8, left + step * (hover + 0.5) - 90));

  return (
    <div className="trend">
      <div className="trend-plot" ref={box} style={{ height }}>
        <svg width={width} height={height} role="img" aria-label={`${unit}趋势堆叠柱状图`} onMouseLeave={() => setHover(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line className="grid-line" x1={left} x2={width - right} y1={top + innerH * t} y2={top + innerH * t} />
              <text className="axis" x={left - 8} y={top + innerH * t + 4} textAnchor="end">
                {compact(max * (1 - t))}
              </text>
            </g>
          ))}
          {buckets.map((b, i) => {
            const x = left + step * (i + 0.5) - barW / 2;
            let y = top + innerH;
            return (
              <g key={b.bucket} opacity={hover === null || hover === i ? 1 : 0.55}>
                <rect x={left + step * i} y={top} width={step} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
                {b.parts.map((p, k) => {
                  if (p.v <= 0) return null;
                  const h = (innerH * p.v) / max;
                  y -= h;
                  const isTop = b.parts.slice(k + 1).every((q) => q.v <= 0);
                  return <rect key={p.model} x={x} y={y} width={barW} height={Math.max(h, 1)} rx={isTop ? Math.min(3, barW / 2) : 0} fill={color(p.model)} pointerEvents="none" />;
                })}
                {i % labelEvery === 0 && (
                  <text className="axis" x={left + step * (i + 0.5)} y={height - 7} textAnchor="middle">
                    {shortDate(b.bucket)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {active && (
          <div className="chart-tip" style={{ left: tipLeft, top: 6 }}>
            <strong>{shortDate(active.bucket)}</strong>
            <div className="tip-total num">
              {number(active.total)} <small>{unit}</small>
            </div>
            {active.parts
              .filter((p) => p.v > 0)
              .sort((a, b) => b.v - a.v)
              .map((p) => (
                <div className="tip-row" key={p.model}>
                  <i style={{ background: color(p.model) }} />
                  <span>{p.model}</span>
                  <b className="num">{number(p.v)}</b>
                </div>
              ))}
          </div>
        )}
        {!hasData && <div className="chart-empty">{empty ?? "当前范围内暂无用量"}</div>}
      </div>
      {legend && hasData && (
        <ul className="legend">
          {models.map((m) => (
            <li key={m}>
              <i style={{ background: color(m) }} />
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
