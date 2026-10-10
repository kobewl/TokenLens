import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call, isDesktop, messageOf, onUsageRefreshed } from "./api";
import type { DayTotal, Overview, Range, SourceReport } from "./types";

export type Filters = { range: Range; app: string; provider: string; model: string };

/**
 * Usage synchronization state (Java analogy: a scheduled service plus a cache-invalidation counter).
 * `revision` increments after every successful sync, so any page keyed on it refetches.
 */
export function useSync(auto: number, onError: (message: string) => void) {
  const [sources, setSources] = useState<SourceReport[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [synced, setSynced] = useState<Date | null>(null);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);

  const refresh = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    setRefreshing(true);
    try {
      setSources(await call<SourceReport[]>("refresh"));
      setSynced(new Date());
      setRevision((v) => v + 1);
    } catch (e) {
      const text = messageOf(e);
      // The menu bar or background loop may already be syncing; that is not an error for the user.
      if (!text.includes("正在进行")) onError(`同步失败：${text}`);
    } finally {
      lock.current = false;
      setRefreshing(false);
    }
  }, [onError]);

  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => void refresh(), auto * 1000);
    return () => window.clearInterval(timer);
  }, [auto, refresh]);
  // Menu-bar "sync now" and the hidden-window background sync notify us here.
  useEffect(() => {
    let off = () => {};
    let alive = true;
    void onUsageRefreshed(() => {
      if (!lock.current) setRevision((v) => v + 1);
    }).then((fn) => (alive ? (off = fn) : fn()));
    return () => {
      alive = false;
      off();
    };
  }, []);

  /** Clearing must not race a running sync; returns false if one is in flight. */
  const clear = useCallback(async () => {
    if (lock.current) return false;
    lock.current = true;
    try {
      await call("clear_usage");
      setSources([]);
      setSynced(null);
      setRevision((v) => v + 1);
      return true;
    } finally {
      lock.current = false;
    }
  }, []);

  return { sources, refreshing, synced, revision, refresh, clear };
}

/** Overview with debounce and stale-response protection; keeps the previous data while loading. */
export function useOverview(f: Filters, revision: number, enabled = true) {
  const [data, setData] = useState<Overview | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const key = JSON.stringify([f.range, f.app, f.provider, f.model]);
  useEffect(() => {
    if (!enabled) return;
    const id = ++generation.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      call<Overview>("overview", { range: f.range, app: f.app, provider: f.provider, model: f.model })
        .then((o) => {
          if (id !== generation.current) return;
          setData(o);
          setLoadedKey(key);
          setError("");
        })
        .catch((e) => {
          if (id !== generation.current) return;
          setData(null);
          setError(messageOf(e));
        })
        .finally(() => id === generation.current && setLoading(false));
    }, 60);
    return () => {
      window.clearTimeout(timer);
      generation.current += 1;
    };
  }, [enabled, key, revision, f.range, f.app, f.provider, f.model]);
  return { data, loading, error, current: loadedKey === key };
}

export function useDaily(days: number, f: Partial<Filters>, revision: number, enabled = true) {
  const [data, setData] = useState<DayTotal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const generation = useRef(0);
  const app = f.app ?? "";
  const provider = f.provider ?? "";
  const model = f.model ?? "";
  useEffect(() => {
    if (!enabled) return;
    const id = ++generation.current;
    call<DayTotal[]>("daily_totals", { days, app, provider, model })
      .then((d) => {
        if (id !== generation.current) return;
        setData(d);
        setLoaded(true);
      })
      .catch(() => id === generation.current && setLoaded(true));
    return () => void (generation.current += 1);
  }, [enabled, days, app, provider, model, revision]);
  return useMemo(() => ({ days: data, loaded }), [data, loaded]);
}

/** Sum of the last `n` calendar days ending `offset` days ago (offset 0 = includes today). */
export function windowTotal(days: DayTotal[], n: number, offset = 0) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() - offset);
  const start = new Date(end);
  start.setDate(end.getDate() - (n - 1));
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [a, b] = [key(start), key(end)];
  return days
    .filter((d) => d.day >= a && d.day <= b)
    .reduce(
      (s, d) => ({
        tokens: s.tokens + d.totalTokens,
        events: s.events + d.eventCount,
        fresh: s.fresh + d.freshInput,
        cacheRead: s.cacheRead + d.cacheReadTokens,
        cacheWrite: s.cacheWrite + d.cacheWriteTokens,
      }),
      { tokens: 0, events: 0, fresh: 0, cacheRead: 0, cacheWrite: 0 },
    );
}

export { isDesktop };
