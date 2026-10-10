import type { ReactNode } from "react";
import { Info } from "lucide-react";

export default function Stat({
  label,
  value,
  sub,
  help,
  footer,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  help?: string;
  footer?: ReactNode;
  loading?: boolean;
}) {
  return (
    <article className="stat">
      <div className="stat-label">
        {label}
        {help && (
          <span title={help} className="stat-help">
            <Info size={13} />
          </span>
        )}
      </div>
      {loading ? <div className="skeleton" style={{ height: 34, width: "60%", marginTop: 8 }} /> : <strong className="num">{value}</strong>}
      {sub && <p className="stat-sub num">{sub}</p>}
      {footer && <div className="stat-foot">{footer}</div>}
    </article>
  );
}
