import type { ReactNode } from "react";

export type ShareRow = { key: string; label: ReactNode; value: number; color: string; right?: string };

/** Ranked horizontal bars: quick answer to "where did it go?". */
export default function ShareBars({ rows, total }: { rows: ShareRow[]; total: number }) {
  return (
    <ul className="share">
      {rows.map((r) => {
        const pct = total > 0 ? (r.value / total) * 100 : 0;
        return (
          <li key={r.key}>
            <div className="share-top">
              <span className="share-label">{r.label}</span>
              <span className="share-val num">
                {r.right ?? r.value.toLocaleString("zh-CN")}
                <small>{pct < 1 && pct > 0 ? "<1" : pct.toFixed(0)}%</small>
              </span>
            </div>
            <div className="share-track" aria-hidden="true">
              <i style={{ width: `${Math.max(pct, pct > 0 ? 1.5 : 0)}%`, background: r.color }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
