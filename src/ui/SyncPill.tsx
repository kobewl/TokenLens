import { RefreshCw } from "lucide-react";
import { clock } from "../lib/format";
import { isDesktop } from "../lib/api";

/** One place to see sync state and trigger a sync (replaces the old always-on topbar clutter). */
export default function SyncPill({ refreshing, synced, onRefresh }: { refreshing: boolean; synced: Date | null; onRefresh: () => void }) {
  return (
    <div className="sync-pill">
      {!isDesktop && <span className="badge warn">演示数据</span>}
      <span className="sync-text" role="status">
        <i className={`dot ${refreshing ? "warn" : synced ? "good" : ""}`} />
        {refreshing ? "正在同步…" : synced ? `${clock(synced)} 已同步` : "等待同步"}
      </span>
      <button className="btn sm" onClick={onRefresh} disabled={refreshing} title="立即同步 (⌘R)">
        <RefreshCw size={14} className={refreshing ? "spin" : ""} />
        立即同步
      </button>
    </div>
  );
}
